import posts from "./blog/posts/*.md";

const blog = document.querySelector("#blog--posts");

for (let post in posts) {
  const article = document.createElement("article");
  article.innerHTML = posts[post];
  blog.insertBefore(article, blog.childNodes[0]);
}
