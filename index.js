import express from "express";
import fs from "fs";

import { SourceMapConsumer } from "source-map";
import cors from "cors";
import dotenv from "dotenv";

const checkEnviromentVariable = (variable) => {
  if (!process.env[variable]) {
    throw new Error(
      `${variable} should be specifed in .env file in root directory`
    );
  }
}

['SOURCE_MAP_DIR', 'LOG_REQUEST_URL', 'PARSER_ENTRY_URL'].forEach(checkEnviromentVariable)

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", true);
dotenv.config({ path: "./.env" });

console.log("start log parser");

const getOriginalPosition = async ({ fileName, line, column }) => {
  if (!fileName || !line || !column) return null;

  const path = `${process.env.SOURCE_MAP_DIR.replace(/\/*$/, "")}/${fileName}.js.map`;

  try {
    const sourceMap = await fs.promises.readFile(path, "utf8");
    try {
      const position = await SourceMapConsumer.with(
        sourceMap,
        null,
        (consumer) =>
          consumer.originalPositionFor({
            line: +line,
            column: +column,
          })
      );
      return position;
    } catch (e) {
      console.log(
        `error while reading originalPosition ${path}:${line}:${column}`,
        e
      );
      return null;
    }
  } catch (e) {
    console.log(`error while reading ${path}`, e);
    return null;
  }
};

const getOriginalStackTrace = async (rawStackTrace) => {
  try {
    let message = "";
    const scriptFilePattern = /\/(\w*[-.]?\w*).js:(\d*):(\d*)/g;
    const matchedFileGroups = [...rawStackTrace.matchAll(scriptFilePattern)];

    if (matchedFileGroups.length) {
      const originalPositionPromises = matchedFileGroups.map(
        ([_, fileName, line, column]) =>
          getOriginalPosition({ fileName, line, column })
      );

      for await (const position of originalPositionPromises) {
        if (position?.source) {
          const { source, line, column } = position;
          message += `${source}:${line}:${column}\n`;
        }
      }
    }
    return message;
  } catch (e) {
    console.log("error while reading stack trace:", e);
    return null;
  }
};

app.post(`${process.env.PARSER_ENTRY_URL}`, async (req, res) => {
  res.send("success");
  let { message, ...params } = req.body;

  const originalStack = await getOriginalStackTrace(message);
  const msg = originalStack?.length
    ? message + `\nOriginal trace:\n` + originalStack
    : message;

  fetch(process.env.LOG_REQUEST_URL, {
    method: "POST",
    body: JSON.stringify({
      message: msg,
      params,
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });
});

app.listen(3001);
