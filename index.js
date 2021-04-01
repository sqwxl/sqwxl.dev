import posts from "assets/posts/*.md";

const blog = document.querySelector("#blog");

for (let post in posts) {
  const article = document.createElement("article");
  article.innerHTML = posts[post];
  blog.appendChild(article);
}
