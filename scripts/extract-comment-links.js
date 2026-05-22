#!/usr/bin/env node

const fs = require("fs");

const URL_PATTERN =
  /\b(?:(?:https?:\/\/|www\.)[^\s<>"'`]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?)/gi;

const TRAILING_PUNCTUATION = /[),.;:!?]+$/;

function usage() {
  console.error("Usage: node scripts/extract-comment-links.js <chat.json> [output.json]");
}

function extractLinks(text) {
  const matches = text.match(URL_PATTERN) || [];

  return matches
    .map((url) => url.replace(TRAILING_PUNCTUATION, ""))
    .filter(Boolean);
}

function advanceAfterValue(stack) {
  const top = stack[stack.length - 1];
  if (!top) return;

  if (top.type === "object") {
    top.state = "afterValue";
    top.key = null;
  } else if (top.type === "array") {
    top.state = "afterValue";
  }
}

function getOutputPath(inputPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const separatorIndex = Math.max(inputPath.lastIndexOf("/"), inputPath.lastIndexOf("\\"));
  const directory = separatorIndex === -1 ? "." : inputPath.slice(0, separatorIndex);

  return `${directory}/output_${timestamp}.json`;
}

function beginContainer(stack, type) {
  const parent = stack[stack.length - 1];
  const parentKey = parent && parent.type === "object" ? parent.key : null;
  const inheritedComments = parent ? parent.inComments : false;
  const inComments =
    inheritedComments || (type === "array" && parentKey === "comments");
  const isCommentsArray = type === "array" && parentKey === "comments";
  const isCommentObject =
    type === "object" && parent && parent.type === "array" && parent.isCommentsArray;
  const comment =
    isCommentObject
      ? { name: null, displayName: null, links: [] }
      : parent
        ? parent.comment
        : null;
  const role = type === "object" && parentKey ? parentKey : null;

  stack.push({
    type,
    state: type === "object" ? "expectKeyOrEnd" : "expectValueOrEnd",
    key: null,
    inComments,
    isCommentsArray,
    isCommentObject,
    comment,
    role,
  });

  if (parent) {
    if (parent.type === "object") {
      parent.state = "afterValue";
      parent.key = null;
    } else if (parent.type === "array") {
      parent.state = "afterValue";
    }
  }
}

function handleStringToken(value, stack) {
  const top = stack[stack.length - 1];
  if (!top) return;

  if (top.type === "object") {
    if (top.state === "expectKey" || top.state === "expectKeyOrEnd") {
      top.key = value;
      top.state = "expectColon";
      return;
    }

    if (top.state === "expectValue") {
      if (top.comment && top.role === "commenter") {
        if (top.key === "name") top.comment.name = value;
        if (top.key === "display_name") top.comment.displayName = value;
      }

      if (top.comment && top.role === "message" && top.key === "body") {
        top.comment.links.push(...extractLinks(value));
      }

      top.state = "afterValue";
      top.key = null;
      return;
    }
  }

  if (
    top.type === "array" &&
    (top.state === "expectValue" || top.state === "expectValueOrEnd")
  ) {
    top.state = "afterValue";
  }
}

function handlePunctuation(char, stack, results) {
  const top = stack[stack.length - 1];

  if (char === "{") {
    beginContainer(stack, "object");
    return;
  }

  if (char === "[") {
    beginContainer(stack, "array");
    return;
  }

  if (char === "}" || char === "]") {
    const finished = stack.pop();
    if (finished && finished.isCommentObject && finished.comment) {
      const name = finished.comment.displayName || finished.comment.name || "";
      for (const link of finished.comment.links) {
        results.push({ name, link });
      }
    }
    return;
  }

  if (!top) return;

  if (char === ":" && top.type === "object" && top.state === "expectColon") {
    top.state = "expectValue";
    return;
  }

  if (char === ",") {
    if (top.type === "object") {
      top.state = "expectKey";
    } else if (top.type === "array") {
      top.state = "expectValue";
    }
  }
}

function handleLiteralCharacter(char, stack) {
  if (!/[tfn0-9-]/.test(char)) return;

  const top = stack[stack.length - 1];
  if (!top) return;

  if (
    (top.type === "object" && top.state === "expectValue") ||
    (top.type === "array" &&
      (top.state === "expectValue" || top.state === "expectValueOrEnd"))
  ) {
    advanceAfterValue(stack);
  }
}

function scanFile(inputPath) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stack = [];
    const stream = fs.createReadStream(inputPath, { encoding: "utf8" });

    let state = "normal";
    let stringValue = "";
    let unicodeBuffer = "";

    stream.on("data", (chunk) => {
      for (const char of chunk) {
        if (state === "string") {
          if (char === "\\") {
            state = "escape";
          } else if (char === '"') {
            handleStringToken(stringValue, stack);
            stringValue = "";
            state = "normal";
          } else {
            stringValue += char;
          }
          continue;
        }

        if (state === "escape") {
          if (char === "u") {
            unicodeBuffer = "";
            state = "unicode";
          } else {
            const escaped = {
              '"': '"',
              "\\": "\\",
              "/": "/",
              b: "\b",
              f: "\f",
              n: "\n",
              r: "\r",
              t: "\t",
            }[char];
            stringValue += escaped === undefined ? char : escaped;
            state = "string";
          }
          continue;
        }

        if (state === "unicode") {
          unicodeBuffer += char;
          if (unicodeBuffer.length === 4) {
            stringValue += String.fromCharCode(parseInt(unicodeBuffer, 16));
            state = "string";
          }
          continue;
        }

        if (char === '"') {
          state = "string";
        } else if ("{}[]:,".includes(char)) {
          handlePunctuation(char, stack, results);
        } else {
          handleLiteralCharacter(char, stack);
        }
      }
    });

    stream.on("error", reject);
    stream.on("end", () => resolve(results));
  });
}

function dedupeByLink(items) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    unique.push(item);
  }

  return unique;
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;

  if (!inputPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const links = dedupeByLink(await scanFile(inputPath));
  const finalOutputPath = outputPath || getOutputPath(inputPath);
  const output = JSON.stringify(links, null, 2) + "\n";

  fs.writeFileSync(finalOutputPath, output);
  console.error(`Saved ${links.length} unique links to ${finalOutputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
