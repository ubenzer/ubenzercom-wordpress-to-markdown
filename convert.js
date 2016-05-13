"use strict";
var xml2js = require("xml2js");
var fs = require("fs-extra");
var toMarkdown = require("to-markdown");
var shortcode = require('shortcode-parser');
var eol = require('eol');
var httpreq = require('httpreq');

shortcode.add('php', function(buf) {
  return '```php\n' + buf + '\n```';
});
shortcode.add('c', function(buf) {
  return '```c\n' + buf + '\n```';
});
shortcode.add('java', function(buf) {
  return '```java\n' + buf + '\n```';
});
shortcode.add('caption', function(buf, opts) {
  if (opts.caption) {
    return opts.caption + "\n" + buf;
  }
  return buf;
});

var Batch = require('batch'), batch = new Batch;
batch.concurrency(20);

fs.emptyDirSync("./out/posts");
var parser = new xml2js.Parser();
var data = fs.readFileSync("export.xml");
parser.parseString(data, function (err, result) {
  if (err) {
    console.log("Error parsing xml: " + err);
  }
  console.log("Parsed XML");
  var posts = result.rss.channel[0].item;
  posts.forEach(processPost);
});

batch.on('progress', function(e){
  console.log(`${e.percent}% - ${e.complete} of ${e.total}`);
});
batch.end(function(err, users){
  console.log(`Download done!`);
});

function processPost(post) {
  if (post["wp:status"][0] !== "publish") {
    return;
  }
  if (post["wp:post_type"][0] !== "post") {
    return;
  }

  var postTitle = post.title;

  console.log("Processing Post: " + postTitle);

  var postDate = new Date(post.pubDate[0]);
  var postData = post["content:encoded"][0];
  var slug = post["wp:post_name"][0];
  var categories = [];

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
            if (href.startsWith("/deepo/")) {
              href = "http://www.ubenzer.com" + href;
            }
            return '[' + content + '](' + href + ')';
          }
        },
        {
          filter: 'img',
          replacement: function(innerHtml, node) {
            let src = node.getAttribute("src");
            if (!src) {
              console.log("IMG WITHOUT SRC!");
              return "";
            }
            let title = "";
            if (node.getAttribute("title")) {
              title = node.getAttribute("title");
            } else if (node.getAttribute("alt")) {
              title = node.getAttribute("alt");
            } else {
              console.log("IMG WITHOUT TITLE: " + src);
            }

            if (src === "https://go.microsoft.com/fwlink/?LinkId=161376") {
              return "";
            }

            let originalSrc = src.replace(/-[^.-]+(?=\.jpg|.gif|.png)/, "").replace(".thumbnail", "");
            if (originalSrc.startsWith("/deepo/")) {
              originalSrc = "http://www.ubenzer.com" + originalSrc;
            }


            let targetSrc = originalSrc;
            if (originalSrc.startsWith("http://www.ubenzer.com") ||
                originalSrc.startsWith("https://www.ubenzer.com")) {

              let urlParts = originalSrc.split("/");
              let fileName = urlParts[urlParts.length-1];
              let downloadPath = fullPath + "/" + fileName;
              downloadFile(originalSrc, downloadPath);
              targetSrc = fileName;
            }

            console.log(`Image: ${originalSrc} ${targetSrc}`);
            return `![${title}](${targetSrc})`; // TODO CLASSNAMES
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
  batch.push(function(done){
    console.log(`Downloading ${url} to ${path}...`);
    httpreq.download(url, path,
        function (err, progress) {},
        function (err){
          if (err) {
            console.log(url, err);
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
