import React, {useState, useMemo} from 'react';
import {
  CodeBlock,
  CodeBlockAction,
  CodeBlockCode,
  ClipboardCopyButton,
  Divider,
  PageSection,
  EmptyState,
  EmptyStateBody,
  EmptyStateHeader,
  EmptyStateIcon,
} from '@patternfly/react-core';
import {ExclamationCircleIcon} from '@patternfly/react-icons';
import {ManifestByDigestResponse} from 'src/resources/TagResource';

interface ManifestProps {
  org: string;
  repo: string;
  digest: string;
  manifestData: ManifestByDigestResponse | null;
}

export function Manifest({manifestData}: ManifestProps) {
  const [copied, setCopied] = useState(false);

  const formattedJson = useMemo(() => {
    if (!manifestData?.manifest_data) {
      return '';
    }
    try {
      const parsed = JSON.parse(manifestData.manifest_data);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return manifestData.manifest_data;
    }
  }, [manifestData?.manifest_data]);

  const clipboardCopyFunc = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const onClick = (text: string) => {
    clipboardCopyFunc(text);
    setCopied(true);
  };

  if (!manifestData) {
    return (
      <>
        <Divider />
        <PageSection>
          <EmptyState>
            <EmptyStateHeader
              titleText="Manifest data not available"
              icon={<EmptyStateIcon icon={ExclamationCircleIcon} />}
              headingLevel="h4"
            />
            <EmptyStateBody>
              Unable to load manifest data for this tag.
            </EmptyStateBody>
          </EmptyState>
        </PageSection>
      </>
    );
  }

  const actions = (
    <React.Fragment>
      <CodeBlockAction>
        <ClipboardCopyButton
          id="manifest-copy-button"
          textId="manifest-content"
          aria-label="Copy manifest to clipboard"
          onClick={() => onClick(formattedJson)}
          exitDelay={copied ? 1500 : 600}
          maxWidth="110px"
          variant="plain"
          onTooltipHidden={() => setCopied(false)}
        >
          {copied ? 'Successfully copied to clipboard!' : 'Copy to clipboard'}
        </ClipboardCopyButton>
      </CodeBlockAction>
    </React.Fragment>
  );

  return (
    <>
      <Divider />
      <PageSection>
        <CodeBlock actions={actions}>
          <CodeBlockCode id="manifest-content">{formattedJson}</CodeBlockCode>
        </CodeBlock>
      </PageSection>
    </>
  );
}
