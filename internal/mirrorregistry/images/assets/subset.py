"""Subset compiled PatternFly CSS to the rules and tokens a page can use.

Usage: python3 -I subset.py <css> <content>... > images.css

A rule is kept when one of its selectors can match: every class it requires
appears in the content files. Classes inside :not() are not required, and an
:is()/:where()/:has() list needs one matching argument. Custom properties are
kept only when reachable through var() from a kept declaration or from the
content files. @font-face rules are kept for upright Red Hat fonts only, with
their URLs rewritten to fonts/<file>.
"""

import re
import sys

WORD = re.compile(r"[A-Za-z0-9_-]+")
VAR_REF = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)")
CLASS = re.compile(r"\.(-?[A-Za-z_][A-Za-z0-9_-]*)")
BLOCK_AT_RULES = ("@media", "@supports", "@layer", "@container")


def parse(css, i=0):
    """Return (nodes, end). A node is [prelude, body]; body is a list of nodes
    for grouping at-rules, a declaration string otherwise, or None for a
    statement such as @charset."""
    nodes, start, depth, quote = [], i, 0, None
    while i < len(css):
        c = css[i]
        if quote:
            if c == "\\":
                i += 1
            elif c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif css.startswith("/*", i):
            i = css.index("*/", i) + 1
            start = i + 1
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif depth == 0 and c == ";":
            nodes.append([css[start:i].strip(), None])
            start = i + 1
        elif depth == 0 and c == "{":
            prelude = css[start:i].strip()
            if prelude.startswith(BLOCK_AT_RULES):
                body, i = parse(css, i + 1)
            else:
                end = matching_brace(css, i)
                body, i = css[i + 1 : end], end
            nodes.append([prelude, body])
            start = i + 1
        elif depth == 0 and c == "}":
            return nodes, i
        i += 1
    return nodes, i


def matching_brace(css, i):
    depth = 0
    for j in range(i, len(css)):
        if css[j] == "{":
            depth += 1
        elif css[j] == "}":
            depth -= 1
            if depth == 0:
                return j
    raise ValueError("unbalanced braces")


def split_top(text, sep):
    parts, depth, quote, start = [], 0, None, 0
    for i, c in enumerate(text):
        if quote:
            if c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
        elif c == sep and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return [p.strip() for p in parts if p.strip()]


def selector_matches(sel, words):
    out, i = [], 0
    while i < len(sel):
        m = re.match(r":(not|is|where|has|nth-[a-z-]+|lang|dir)\(", sel[i:])
        if m:
            depth, j = 1, i + len(m.group(0))
            while depth:
                depth += {"(": 1, ")": -1}.get(sel[j], 0)
                j += 1
            inner = sel[i + len(m.group(0)) : j - 1]
            if m.group(1) in ("is", "where", "has"):
                if not any(selector_matches(arg, words) for arg in split_top(inner, ",")):
                    return False
            i = j
            continue
        if sel[i] == "[":
            i = sel.index("]", i) + 1
            continue
        out.append(sel[i])
        i += 1
    return all(c in words for c in CLASS.findall("".join(out)))


def prune_selectors(nodes, words):
    kept = []
    for prelude, body in nodes:
        if isinstance(body, list):
            body = prune_selectors(body, words)
            if body:
                kept.append([prelude, body])
        elif body is None or prelude.startswith("@"):
            kept.append([prelude, body])
        else:
            selectors = [s for s in split_top(prelude, ",") if selector_matches(s, words)]
            if selectors:
                kept.append([",\n".join(selectors), body])
    return kept


def keep_font_face(body):
    return "Italic" not in body and "RedHat" in body


def declarations(body):
    return [d for d in split_top(body, ";") if ":" in d]


def walk(nodes):
    for prelude, body in nodes:
        if isinstance(body, list):
            yield from walk(body)
        elif body is not None:
            yield prelude, body


def used_variables(nodes, content):
    defs, refs = {}, set(VAR_REF.findall(content))
    for prelude, body in walk(nodes):
        if prelude.startswith("@keyframes"):
            refs.update(VAR_REF.findall(body))
            continue
        for decl in declarations(body):
            name, value = decl.split(":", 1)
            name = name.strip()
            if name.startswith("--"):
                defs.setdefault(name, []).append(value)
            else:
                refs.update(VAR_REF.findall(value))
    used, todo = set(), list(refs)
    while todo:
        name = todo.pop()
        if name in used:
            continue
        used.add(name)
        for value in defs.get(name, []):
            todo.extend(VAR_REF.findall(value))
    return used


def render(nodes, used, indent=""):
    out = []
    for prelude, body in nodes:
        if body is None:
            out.append(f"{indent}{prelude};")
            continue
        if isinstance(body, list):
            inner = render(body, used, indent + "  ")
            if inner:
                out.append(f"{indent}{prelude} {{\n{inner}\n{indent}}}")
            continue
        if prelude.startswith("@font-face"):
            if not keep_font_face(body):
                continue
            body = re.sub(r"\./assets/fonts/\w+/", "fonts/", body)
        if prelude.startswith("@keyframes"):
            out.append(f"{indent}{prelude} {{{body}}}")
            continue
        decls = [
            d
            for d in declarations(body)
            if not d.startswith("--") or d.split(":", 1)[0].strip() in used
        ]
        if decls:
            lines = "".join(f"{indent}  {d};\n" for d in decls)
            out.append(f"{indent}{prelude} {{\n{lines}{indent}}}")
    return "\n".join(out)


def main():
    css = open(sys.argv[1], encoding="utf-8").read()
    content = "".join(open(p, encoding="utf-8").read() for p in sys.argv[2:])
    words = set(WORD.findall(content))
    nodes, _ = parse(css)
    nodes = prune_selectors(nodes, words)
    print(render(nodes, used_variables(nodes, content)))


if __name__ == "__main__":
    main()
