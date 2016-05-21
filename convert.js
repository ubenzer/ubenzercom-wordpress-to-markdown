"use strict";
let firebase = require("firebase");
firebase.initializeApp({
  databaseURL: "https://ubenzer.firebaseio.com/",
  serviceAccount: "firebase-key.json"
});

// As an admin, the app has access to read and write all data, regardless of Security Rules
let db = firebase.database();
let allComments = db.ref("comments");
allComments.set({});

let xml2js = require("xml2js");
let fs = require("fs-extra");
let path = require("path");
let toMarkdown = require("to-markdown");
let shortcode = require("shortcode-parser");
let eol = require("eol");
let httpreq = require("httpreq");
let Batch = require("batch");

shortcode.add("php", function(buf) {
  return "```php\n" + buf + "\n```";
});
shortcode.add("c", function(buf) {
  return "```c\n" + buf + "\n```";
});
shortcode.add("java", function(buf) {
  return "```java\n" + buf + "\n```";
});
shortcode.add("caption", function(buf, opts) {
  if (opts.caption) {
    return opts.caption + "\n" + buf;
  }
  return buf;
});

let downloadedFiles = new Set();
let batch = new Batch;
batch.concurrency(30);

//fs.emptyDirSync("./out/posts");

let idLookup = {};
let parser = new xml2js.Parser();
let data = fs.readFileSync("/Users/ub/Downloads/ubenzerumutbenzerodakim.wordpress.2016-05-19.xml");
parser.parseString(data, function (err, result) {
  if (err) {
    console.log("Error parsing xml: " + err);
  }
  console.log("Parsed XML");
  var posts = result.rss.channel[0].item;
  posts.forEach(createIdLookup);
  posts.forEach(processPost);
});

batch.on("progress", function(e) {
  console.log(`${e.percent}% - ${e.complete} of ${e.total}`);
});
batch.end(function() {
  console.log(`Batch jobs done!`);
  process.exit(0);
});

function isPostValid(post) {
  if (post["wp:status"][0] !== "publish") {
    return false;
  }
  if (post["wp:post_type"][0] !== "post") {
    return false;
  }
  return true;
}
function createIdLookup(post) {
  if (!isPostValid(post)) { return; }

  var slug = post["wp:post_name"][0];
  var postDate = new Date(post.pubDate[0]);
  var id = postDate.getFullYear() + "/" + getPaddedNumber(postDate.getMonth() + 1) + "/" + slug;

  idLookup[slug] = id;
}

function processPost(post) {
  if (!isPostValid(post)) { return; }

  var postTitle = post.title;

  console.log("Processing Post: " + postTitle);

  var postDate = new Date(post.pubDate[0]);
  var postData = post["content:encoded"][0];
  var slug = post["wp:post_name"][0];
  var categories = [];
  var id = postDate.getFullYear() + "/" + getPaddedNumber(postDate.getMonth() + 1) + "/" + slug;

  // process post comments
  let comments = post["wp:comment"];
  if (comments instanceof Array) {
    comments.forEach((comment) => {
      uploadComment(id, comment);
    });
  }

  // end comments

  post.category.forEach(function(categoryBlob) {
    var cat = categoryBlob._;
    if (categoryBlob.$.domain !== "category") {
      return;
    }
    if (cat === "İlişkiler" || cat === "Kişisel" || cat === "Markalar" || cat == "Türkçe") {
      cat = "Hayat/" +  cat;
    } else if (cat === "Scala" || cat === "PHP" || cat === "JAVA" || cat == "ANSI C" || cat == ".NET") {
      cat = "Bilgisayar/Programlama/" +  cat;
    } else if (cat === "Windows" || cat === "Programlama" || cat === "Bilmuh’çular için" ||
        cat === "İnternet" || cat === "Linux" || cat === "Mac" || cat === "Bilgisayar Oyunları" ||
        cat === "Android") {
      cat = "Bilgisayar/" +  cat;
    } else if (cat === "Minecraft") {
      cat = "Bilgisayar/Bilgisayar Oyunları/" +  cat;
    }
    categories.push(cat);
  });

  var fullPath = "./out/posts/" + postDate.getFullYear() + "/" + getPaddedNumber(postDate.getMonth() + 1) + "/" + slug;
  fs.ensureDirSync(fullPath);

  // Convert two new lines to paragraphs
  postData = eol.lf(postData);
  postData = postData.split("<!--more-->");
  postData = postData.join("<p>---more---</p>");
  postData = postData.split("\n\n");
  postData = postData.map(function(aData) {
    return `<p>${aData}</p>`;
  });
  postData = postData.join("\n");

  var markdown = null;
  try {
    markdown = toMarkdown(postData, {
      converters: [
        {
          filter: function (node) {
            return node.nodeName === 'A' && node.getAttribute('href');
          },
          replacement: function(content, node) {
            let href = node.getAttribute('href');

            if (isUBenzerUrl(href)) {
              let source = normalizeUBenzerUrl(href);
              let target = normalizeUBenzerUrl(href, true);
              let downloadPath = fullPath + "/" + target;

              if (isFileImage(target)) {
                console.log("THIS IS AN UBENZER IMAGE! " + source);
                downloadFile(source, downloadPath);
                // TODO we need to check if it links to itself or something special
                // ‌‌node.querySelectorAll("*").length
                // ‌‌node.querySelectorAll("img").length
                // ‌‌node.querySelectorAll("img")[0].getAttribute("src")
                return `[${content}](${target})`;
              } else if (path.extname(target) !== "") {
                downloadFile(source, downloadPath);
                return `[${content}](${target})`;
              } else {
                // this is an internal link
                if (!idLookup[target]) {
                  throw new Error("NOT FOUND INTERNAL LINK: " + href);
                }
                return `[${content}](@${idLookup[target]})`;
              }
            }
            // TODO target blank
            return `[${content}](${href})`;
          }
        },
        {
          filter: 'img',
          replacement: function(innerHtml, node) {
            let src = node.getAttribute("src");
            if (!src) { throw new Error("IMG WITHOUT SRC!"); }
            let title = "";
            if (node.getAttribute("title")) {
              title = node.getAttribute("title");
            } else if (node.getAttribute("alt")) {
              title = node.getAttribute("alt");
            } else {
              console.log("IMG WITHOUT TITLE: " + src);  // TODO how many?
            }

            if (src === "https://go.microsoft.com/fwlink/?LinkId=161376") {
              return "";
            }

            var targetSrc = src;
            if (isUBenzerUrl(src)) {
              let source = normalizeUBenzerUrl(src);
              let target = normalizeUBenzerUrl(src, true);

              let downloadPath = fullPath + "/" + target;
              downloadFile(source, downloadPath);
              targetSrc = target;
            }

            let classes = [];
            if (node.classList.contains("alignright")) {
              classes.push("right");
            } else if (node.classList.contains("alignleft")) {
              classes.push("left");
            } else if (node.classList.contains("aligncenter")) {
              classes.push("center");
            }

            let text = `![${title}](${targetSrc})`;
            if (classes.length > 0) {
              text = `${text}{${classes.join(",")}}`;
            }
            console.log(text);
            return text;
          }
        },
        {
          filter: 'strong',
          replacement: function(innerHtml) {
            return `*${innerHtml}*`;
          }
        }
      ]
    });
  } catch(e) {
    console.error(postData);
    throw e;
  }

  markdown = shortcode.parse(markdown);

  markdown = "# " + postTitle + "\n\n" + markdown;

  var header = "";
  header += "---\n";
  header += "created: " + postDate.getFullYear() + "-" + getPaddedNumber(postDate.getMonth() + 1) + "-" + getPaddedNumber(postDate.getDate()) + "\n";
  if (categories.length > 0) {
    header += "category:\n";
    categories.forEach(function(category) {
      header += "  - " + category + "\n";
    });
  }

  header += "---\n";

  fs.outputFile(fullPath + "/index.md", header + markdown, function(err) {
    if(err !== null) {
      console.error("Error writing post " + postTitle + " to disk!");
      throw err;
    }
  });
}

function downloadFile(url, path) {
  return;
  if (url.startsWith("/deepo/")) {
    url = "http://www.ubenzer.com" + url;
  }
  if (downloadedFiles.has(url+path)) { return; }
  downloadedFiles.add(url+path);
  batch.push(function(done){
    console.log(`Downloading ${url} to ${path}...`);
    httpreq.download(url, path,
        function (err, progress) {},
        function (err){
          if (err) {
            console.log("FAILED DOWNLOAD :" + url, err);
          }
          done();
        });
  });
}

function uploadComment(id, comment) {
  batch.push(function(done) {
    let postCommentsRef = allComments.child(id);
    postCommentsRef.push({
      name: comment["wp:comment_author"][0],
      date: new Date(comment["wp:comment_date_gmt"][0]),
      data: comment["wp:comment_content"][0]
    }, function (error) {
      if (error) {
        console.error(error);
        throw new Error(error);
      }
      done();
    });
  });
}

function getPaddedNumber(num) {
  if (num < 10) {
    return "0" + num;
  }
  return num;
}

function isFileImage(file) {
  file = file.toLowerCase();
  return file.endsWith(".jpg") || file.endsWith(".png") || file.endsWith(".gif");
}

function isUBenzerUrl(url) {
  return url.startsWith("/deepo/") || url.startsWith("http://www.ubenzer.com/") ||
    url.startsWith("https://www.ubenzer.com") || url.startsWith("//www.ubenzer.com") ||
    url.startsWith("http://ubenzer.com/") ||
    url.startsWith("https://ubenzer.com") || url.startsWith("//ubenzer.com");
}

function normalizeUBenzerUrl(url, isTarget) {
  // if this is an image, we don't give a shit about small versions
  url = url.replace(/-\d+x\d+\.(jpg|png|gif|JPG|PNG|GIF)$/, '.$1');
  url = url.replace(".thumbnail", "");

  if (!isTarget) { return url; }

  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  let urlParts = url.split("/");
  let fileName = urlParts[urlParts.length - 1].toLowerCase();
  return fileName;
}
