import posts from "assets/posts/*.md";

// console.log(md);

const blog = document.querySelector("#blog-section")

for (let post in posts) {
    console.log(post, posts[post])
    const article = document.createElement("article");
    article.innerHTML = posts[post];
    blog.appendChild(article);
}
