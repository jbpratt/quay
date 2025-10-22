# Complete Examples

## Table of Contents
- [Full Feature Example](#full-feature-example)
- [Complete Component with Suspense](#complete-component-with-suspense)
- [Form with Validation](#form-with-validation)
- [Data Table with Actions](#data-table-with-actions)
- [Complete Cypress Test Suite](#complete-cypress-test-suite)

---

## Full Feature Example

### File Structure

```
features/
  posts/
    api/
      postsApi.ts
    components/
      PostList.tsx
      PostCard.tsx
      CreatePostModal.tsx
    hooks/
      usePosts.ts
    types/
      index.ts
    __tests__/
      PostList.test.tsx
    index.ts
```

### API Layer

```typescript
// features/posts/api/postsApi.ts
import { apiClient } from '@/lib/apiClient';
import type { Post, CreatePostInput } from '../types';

export const postsApi = {
    async getPosts(): Promise<Post[]> {
        const { data } = await apiClient.get<Post[]>('/posts');
        return data;
    },

    async getPost(id: number): Promise<Post> {
        const { data } = await apiClient.get<Post>(`/posts/${id}`);
        return data;
    },

    async createPost(input: CreatePostInput): Promise<Post> {
        const { data } = await apiClient.post<Post>('/posts', input);
        return data;
    },

    async updatePost(id: number, input: Partial<CreatePostInput>): Promise<Post> {
        const { data } = await apiClient.put<Post>(`/posts/${id}`, input);
        return data;
    },

    async deletePost(id: number): Promise<void> {
        await apiClient.delete(`/posts/${id}`);
    },
};
```

### Types

```typescript
// features/posts/types/index.ts
export interface Post {
    id: number;
    title: string;
    content: string;
    author: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreatePostInput {
    title: string;
    content: string;
}
```

### Hook

```typescript
// features/posts/hooks/usePosts.ts
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '../api/postsApi';
import type { CreatePostInput } from '../types';

export const usePosts = () => {
    const queryClient = useQueryClient();

    const { data: posts } = useSuspenseQuery({
        queryKey: ['posts'],
        queryFn: postsApi.getPosts,
    });

    const createMutation = useMutation({
        mutationFn: postsApi.createPost,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['posts'] });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: postsApi.deletePost,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['posts'] });
        },
    });

    return {
        posts,
        createPost: createMutation.mutateAsync,
        deletePost: deleteMutation.mutateAsync,
        isCreating: createMutation.isPending,
        isDeleting: deleteMutation.isPending,
    };
};
```

### Component

```typescript
// features/posts/components/PostList.tsx
import React, { useState, useCallback } from 'react';
import {
    Card,
    CardBody,
    Grid,
    GridItem,
    Button,
    Alert,
} from '@patternfly/react-core';
import { PlusCircleIcon } from '@patternfly/react-icons';
import { usePosts } from '../hooks/usePosts';
import { PostCard } from './PostCard';
import { CreatePostModal } from './CreatePostModal';

export const PostList: React.FC = () => {
    const { posts, deletePost } = usePosts();
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDelete = useCallback(async (id: number) => {
        try {
            await deletePost(id);
        } catch (err) {
            setError('Failed to delete post');
        }
    }, [deletePost]);

    const handleCreateSuccess = useCallback(() => {
        setIsCreateModalOpen(false);
    }, []);

    return (
        <>
            {error && (
                <Alert
                    variant="danger"
                    title={error}
                    actionClose={
                        <button onClick={() => setError(null)}>×</button>
                    }
                    data-testid="error-alert"
                />
            )}

            <Card data-testid="post-list-card">
                <CardBody>
                    <div style={{ marginBottom: '1rem' }}>
                        <Button
                            variant="primary"
                            icon={<PlusCircleIcon />}
                            onClick={() => setIsCreateModalOpen(true)}
                            data-testid="create-post-button"
                        >
                            Create Post
                        </Button>
                    </div>

                    <Grid hasGutter>
                        {posts.map(post => (
                            <GridItem key={post.id} span={12} md={6} lg={4}>
                                <PostCard
                                    post={post}
                                    onDelete={handleDelete}
                                />
                            </GridItem>
                        ))}
                    </Grid>
                </CardBody>
            </Card>

            <CreatePostModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSuccess={handleCreateSuccess}
            />
        </>
    );
};

export default PostList;
```

### Route

```typescript
// routes/posts/index.tsx
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const PostList = lazy(() => import('@/features/posts/components/PostList'));

export const Route = createFileRoute('/posts/')({
    component: PostList,
    loader: () => ({ crumb: 'Posts' }),
});
```

---

## Complete Component with Suspense

```typescript
// features/posts/components/PostCard.tsx
import React, { useState, useCallback } from 'react';
import {
    Card,
    CardTitle,
    CardBody,
    CardFooter,
    Button,
    Modal,
    ModalVariant,
} from '@patternfly/react-core';
import { TrashIcon, EditIcon } from '@patternfly/react-icons';
import type { Post } from '../types';

interface PostCardProps {
    post: Post;
    onDelete: (id: number) => Promise<void>;
}

export const PostCard: React.FC<PostCardProps> = ({ post, onDelete }) => {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = useCallback(async () => {
        setIsDeleting(true);
        try {
            await onDelete(post.id);
            setIsDeleteModalOpen(false);
        } catch (error) {
            // Error is handled by parent
        } finally {
            setIsDeleting(false);
        }
    }, [onDelete, post.id]);

    return (
        <>
            <Card data-testid={`post-card-${post.id}`}>
                <CardTitle data-testid="post-title">
                    {post.title}
                </CardTitle>
                <CardBody data-testid="post-content">
                    <p>{post.content}</p>
                    <p>
                        <small>By {post.author}</small>
                    </p>
                </CardBody>
                <CardFooter>
                    <Button
                        variant="secondary"
                        icon={<EditIcon />}
                        data-testid={`edit-post-button-${post.id}`}
                    >
                        Edit
                    </Button>
                    <Button
                        variant="danger"
                        icon={<TrashIcon />}
                        onClick={() => setIsDeleteModalOpen(true)}
                        data-testid={`delete-post-button-${post.id}`}
                    >
                        Delete
                    </Button>
                </CardFooter>
            </Card>

            <Modal
                variant={ModalVariant.small}
                title="Confirm Delete"
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                data-testid="delete-confirmation-modal"
                actions={[
                    <Button
                        key="confirm"
                        variant="danger"
                        onClick={handleDelete}
                        isLoading={isDeleting}
                        data-testid="confirm-delete-button"
                    >
                        Delete
                    </Button>,
                    <Button
                        key="cancel"
                        variant="link"
                        onClick={() => setIsDeleteModalOpen(false)}
                        data-testid="cancel-delete-button"
                    >
                        Cancel
                    </Button>,
                ]}
            >
                Are you sure you want to delete "{post.title}"?
            </Modal>
        </>
    );
};
```

---

## Form with Validation

```typescript
// features/posts/components/CreatePostModal.tsx
import React from 'react';
import {
    Modal,
    ModalVariant,
    Form,
    FormGroup,
    TextInput,
    TextArea,
    Button,
    Alert,
} from '@patternfly/react-core';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '../api/postsApi';
import type { CreatePostInput } from '../types';

const createPostSchema = z.object({
    title: z.string().min(1, 'Title is required').max(100, 'Title is too long'),
    content: z.string().min(1, 'Content is required').max(5000, 'Content is too long'),
});

interface CreatePostModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export const CreatePostModal: React.FC<CreatePostModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
}) => {
    const queryClient = useQueryClient();

    const {
        control,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<CreatePostInput>({
        resolver: zodResolver(createPostSchema),
        defaultValues: {
            title: '',
            content: '',
        },
    });

    const mutation = useMutation({
        mutationFn: postsApi.createPost,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['posts'] });
            reset();
            onSuccess();
        },
    });

    const onSubmit = (data: CreatePostInput) => {
        mutation.mutate(data);
    };

    const handleClose = () => {
        if (!mutation.isPending) {
            reset();
            mutation.reset();
            onClose();
        }
    };

    return (
        <Modal
            variant={ModalVariant.medium}
            title="Create New Post"
            isOpen={isOpen}
            onClose={handleClose}
            data-testid="create-post-modal"
            actions={[
                <Button
                    key="create"
                    variant="primary"
                    onClick={handleSubmit(onSubmit)}
                    isLoading={mutation.isPending}
                    data-testid="submit-post-button"
                >
                    Create
                </Button>,
                <Button
                    key="cancel"
                    variant="link"
                    onClick={handleClose}
                    isDisabled={mutation.isPending}
                    data-testid="cancel-post-button"
                >
                    Cancel
                </Button>,
            ]}
        >
            {mutation.isError && (
                <Alert
                    variant="danger"
                    title="Failed to create post"
                    data-testid="error-alert"
                    style={{ marginBottom: '1rem' }}
                />
            )}

            <Form>
                <FormGroup
                    label="Title"
                    isRequired
                    fieldId="title"
                    validated={errors.title ? 'error' : 'default'}
                    helperTextInvalid={errors.title?.message}
                >
                    <Controller
                        name="title"
                        control={control}
                        render={({ field }) => (
                            <TextInput
                                {...field}
                                id="title"
                                type="text"
                                validated={errors.title ? 'error' : 'default'}
                                data-testid="title-input"
                            />
                        )}
                    />
                </FormGroup>

                <FormGroup
                    label="Content"
                    isRequired
                    fieldId="content"
                    validated={errors.content ? 'error' : 'default'}
                    helperTextInvalid={errors.content?.message}
                >
                    <Controller
                        name="content"
                        control={control}
                        render={({ field }) => (
                            <TextArea
                                {...field}
                                id="content"
                                rows={6}
                                validated={errors.content ? 'error' : 'default'}
                                data-testid="content-input"
                            />
                        )}
                    />
                </FormGroup>
            </Form>
        </Modal>
    );
};
```

---

## Data Table with Actions

```typescript
// features/posts/components/PostsTable.tsx
import React, { useMemo } from 'react';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { Button } from '@patternfly/react-core';
import { EditIcon, TrashIcon } from '@patternfly/react-icons';
import { usePosts } from '../hooks/usePosts';
import type { Post } from '../types';

export const PostsTable: React.FC = () => {
    const { posts, deletePost } = usePosts();

    const columns = useMemo(
        () => ['Title', 'Author', 'Created', 'Actions'],
        []
    );

    const formatDate = (dateString: string): string => {
        return new Date(dateString).toLocaleDateString();
    };

    return (
        <Table variant="compact" data-testid="posts-table">
            <Thead>
                <Tr>
                    {columns.map(col => (
                        <Th key={col}>{col}</Th>
                    ))}
                </Tr>
            </Thead>
            <Tbody>
                {posts.map(post => (
                    <Tr key={post.id} data-testid={`post-row-${post.id}`}>
                        <Td data-testid={`post-title-${post.id}`}>
                            {post.title}
                        </Td>
                        <Td data-testid={`post-author-${post.id}`}>
                            {post.author}
                        </Td>
                        <Td data-testid={`post-date-${post.id}`}>
                            {formatDate(post.createdAt)}
                        </Td>
                        <Td>
                            <Button
                                variant="plain"
                                icon={<EditIcon />}
                                data-testid={`edit-button-${post.id}`}
                            />
                            <Button
                                variant="plain"
                                icon={<TrashIcon />}
                                onClick={() => deletePost(post.id)}
                                data-testid={`delete-button-${post.id}`}
                            />
                        </Td>
                    </Tr>
                ))}
            </Tbody>
        </Table>
    );
};
```

---

## Complete Cypress Test Suite

```typescript
// cypress/e2e/posts/post-management.cy.ts
describe('Post Management', () => {
    beforeEach(() => {
        // Setup: Login and intercept API calls
        cy.login('test@example.com', 'password123');
        cy.intercept('GET', '/api/posts', { fixture: 'posts.json' }).as('getPosts');
        cy.intercept('POST', '/api/posts').as('createPost');
        cy.intercept('DELETE', '/api/posts/*').as('deletePost');
        cy.visit('/posts');
        cy.wait('@getPosts');
    });

    describe('View Posts', () => {
        it('should display list of posts', () => {
            cy.findByTestId('post-list-card').should('be.visible');
            cy.findByTestId('post-card-1').should('be.visible');
            cy.findByTestId('post-card-2').should('be.visible');
        });

        it('should show post details in card', () => {
            cy.findByTestId('post-card-1').within(() => {
                cy.findByTestId('post-title').should('contain', 'First Post');
                cy.findByTestId('post-content').should('contain', 'This is the first post');
            });
        });
    });

    describe('Create Post', () => {
        it('should create a new post successfully', () => {
            // Open modal
            cy.findByTestId('create-post-button').click();
            cy.findByTestId('create-post-modal').should('be.visible');

            // Fill form
            cy.findByTestId('title-input').type('My New Post');
            cy.findByTestId('content-input').type('This is the content of my new post');

            // Submit
            cy.intercept('POST', '/api/posts', {
                statusCode: 201,
                body: {
                    id: 3,
                    title: 'My New Post',
                    content: 'This is the content of my new post',
                    author: 'Test User',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            }).as('createPostSuccess');

            cy.findByTestId('submit-post-button').click();

            // Verify
            cy.wait('@createPostSuccess');
            cy.findByTestId('create-post-modal').should('not.exist');
        });

        it('should show validation errors for empty fields', () => {
            cy.findByTestId('create-post-button').click();
            cy.findByTestId('submit-post-button').click();

            // Check validation messages
            cy.findByText('Title is required').should('be.visible');
            cy.findByText('Content is required').should('be.visible');
        });

        it('should handle server errors gracefully', () => {
            cy.findByTestId('create-post-button').click();

            cy.findByTestId('title-input').type('Test Post');
            cy.findByTestId('content-input').type('Test content');

            cy.intercept('POST', '/api/posts', {
                statusCode: 500,
                body: { error: 'Internal Server Error' },
            }).as('createPostError');

            cy.findByTestId('submit-post-button').click();
            cy.wait('@createPostError');

            cy.findByTestId('error-alert').should('be.visible');
        });
    });

    describe('Delete Post', () => {
        it('should delete post with confirmation', () => {
            // Click delete button
            cy.findByTestId('delete-post-button-1').click();

            // Confirm in modal
            cy.findByTestId('delete-confirmation-modal').should('be.visible');
            cy.findByTestId('confirm-delete-button').click();

            // Verify deletion
            cy.wait('@deletePost');
        });

        it('should cancel delete when clicking cancel', () => {
            cy.findByTestId('delete-post-button-1').click();
            cy.findByTestId('delete-confirmation-modal').should('be.visible');
            cy.findByTestId('cancel-delete-button').click();
            cy.findByTestId('delete-confirmation-modal').should('not.exist');
            cy.findByTestId('post-card-1').should('exist');
        });
    });

    describe('User Journey', () => {
        it('should complete full post lifecycle', () => {
            // Create post
            cy.findByTestId('create-post-button').click();
            cy.fillForm({
                title: 'Journey Post',
                content: 'This is a journey test',
            });
            cy.findByTestId('submit-post-button').click();

            // Verify creation
            cy.findByTestId('post-card-3').should('be.visible');

            // Delete post
            cy.findByTestId('delete-post-button-3').click();
            cy.findByTestId('confirm-delete-button').click();
            cy.wait('@deletePost');
        });
    });
});
```

```typescript
// cypress/fixtures/posts.json
{
    "posts": [
        {
            "id": 1,
            "title": "First Post",
            "content": "This is the first post",
            "author": "John Doe",
            "createdAt": "2024-01-01T10:00:00Z",
            "updatedAt": "2024-01-01T10:00:00Z"
        },
        {
            "id": 2,
            "title": "Second Post",
            "content": "This is the second post",
            "author": "Jane Smith",
            "createdAt": "2024-01-02T10:00:00Z",
            "updatedAt": "2024-01-02T10:00:00Z"
        }
    ]
}
```

---

## Key Takeaways

### Component Structure
✅ Use `React.FC<Props>` for type safety
✅ Lazy load heavy components
✅ Wrap in Suspense boundaries
✅ Add `data-testid` for testing

### Data Fetching
✅ Use `useSuspenseQuery` for data
✅ Create API service layer
✅ Use mutations with cache invalidation
✅ Handle errors gracefully

### Forms
✅ Use React Hook Form + Zod
✅ Controller for PatternFly inputs
✅ Validation messages
✅ Loading states

### Testing
✅ Use `data-testid` selectors
✅ Mock API responses
✅ Test user journeys
✅ AAA pattern (Arrange, Act, Assert)

### PatternFly
✅ Use PatternFly components
✅ Follow design system
✅ Use CSS variables
✅ Responsive grid layout
