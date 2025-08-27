// assets/js/blog.js

// Wait for the DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    const blogPostsContainer = document.getElementById('blog-posts-container');
    const postContentContainer = document.getElementById('post-content');

    // Check if we are on the blog listing page (blog.html)
    if (blogPostsContainer) {
        loadBlogPosts();
    }

    // Check if we are on a single post page (post.html)
    if (postContentContainer) {
        loadSinglePost();
    }

});

/**
 * Fetches the posts.json manifest and dynamically creates
 * a card for each blog post on the blog.html page.
 */
async function loadBlogPosts() {
    try {
        const response = await fetch('/posts.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const posts = await response.json();
        const container = document.getElementById('blog-posts-container');
        
        // Clear any placeholder content
        container.innerHTML = ''; 

        if (posts.length === 0) {
            container.innerHTML = '<p class="text-center text-secondary">No posts yet. Check back soon!</p>';
            return;
        }

        posts.forEach(post => {
            const postCardHTML = `
                <div class="col-lg-8 mx-auto">
                    <div class="card post-card p-4">
                        <div class="card-body">
                            <h3 class="card-title">${post.title}</h3>
                            <p class="card-subtitle mb-2 text-muted">${new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                            <p class="card-text">${post.summary}</p>
                            <a href="/post.html?post=${post.slug}" class="btn btn-primary">Read More</a>
                        </div>
                    </div>
                </div>
            `;
            container.innerHTML += postCardHTML;
        });

    } catch (error) {
        console.error("Failed to load blog posts:", error);
        document.getElementById('blog-posts-container').innerHTML = '<p class="text-center text-danger">Could not load posts. Please try again later.</p>';
    }
}

/**
 * Loads a single blog post based on the URL parameter,
 * fetches its Markdown content, converts it to HTML,
 * and injects it into the post.html page.
 */
async function loadSinglePost() {
    try {
        // 1. Get the post slug from the URL
        const urlParams = new URLSearchParams(window.location.search);
        const postSlug = urlParams.get('post');

        if (!postSlug) {
            throw new Error("No post specified in the URL.");
        }

        // 2. Fetch the posts manifest to find the correct post
        const response = await fetch('/posts.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const posts = await response.json();
        const post = posts.find(p => p.slug === postSlug);

        if (!post) {
            throw new Error(`Post with slug "${postSlug}" not found.`);
        }

        // 3. Update the page metadata
        document.title = post.title;
        document.getElementById('post-title').textContent = post.title;
        document.getElementById('post-date').textContent = new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        // 4. Fetch the Markdown content of the post
        const markdownResponse = await fetch(post.path);
        if (!markdownResponse.ok) {
            throw new Error(`Could not fetch markdown file at ${post.path}`);
        }
        const markdownText = await markdownResponse.text();

        // 5. Convert Markdown to HTML using marked.js
        const postHTML = marked.parse(markdownText);

        // 6. Inject the HTML into the page
        document.getElementById('post-content').innerHTML = postHTML;

    } catch (error) {
        console.error("Failed to load the post:", error);
        document.getElementById('post-content').innerHTML = `<p class="text-center text-danger">Error: ${error.message}</p>`;
    }
}
