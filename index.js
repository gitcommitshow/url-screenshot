import http from 'http';
import url from "url";
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";

const SCREENSHOT_FOLDER_NAME = "screenshots";
const IMG_DIRECTORY = process.env.IMG_DIRECTORY || path.join(process.cwd(), SCREENSHOT_FOLDER_NAME);
const SITE_URL = process.env.SITE_URL || "http://localhost:3000";
const PORT = process.env.PORT || 3000;
const SUPPORTED_FILETYPES = ["png", "jpeg"];
const DEFAULT_FILETYPE = "png";

const server = http.createServer();
server.on("request", async (req, res) => {
    const parsedUrl = url.parse(req.url);
    const pathWithoutQuery = parsedUrl.pathname;
    const queryString = parsedUrl.query;
    console.log(req.method + " " + pathWithoutQuery);
    if (queryString) console.log(queryString.substring(0, 20) + "...");
    const rootPath = pathWithoutQuery.split("/")?.slice(0, 2)?.join("/");
    switch (req.method + " " + rootPath) {
        /**
         * POST /screenshot
         * Body: { url: "fullPageUrl", fileType?: "png", storageService?: "cloudinary", width?: 1200, height?: 630, clip?: { x: 0, y: 0 } }
         */
        case "POST /screenshot":
            let body = "";
            req.on("data", (chunk) => {
                body += chunk.toString(); // convert Buffer to string
            });
            req.on("end", async () => {
                console.log("Request to create screenshot for: " + body);
                let bodyJson;
                try {
                    // { url: https://...., size: "social" }
                    bodyJson = JSON.parse(body);
                } catch (err) {
                    // url=https://....&size=social
                    bodyJson = queryStringToJson(body);
                }
                if (!bodyJson || !bodyJson.url || !isValidUrl(bodyJson.url)) {
                    res.writeHead(400, { Location: "/" });
                    return res.end()
                }
                try {
                    let screenshotOptions = {};
                    if (bodyJson.clip) {
                        screenshotOptions.clip = bodyJson.clip;
                    }
                    if (bodyJson.width && bodyJson.height) {
                        screenshotOptions.width = bodyJson.width;
                        screenshotOptions.height = bodyJson.height;
                    }
                    screenshotOptions.storageService = bodyJson.storageService;
                    screenshotOptions.fileType = bodyJson.fileType;
                    const screenshot = await generateScreenshot(bodyJson.url, screenshotOptions);
                    res.writeHead(200, { "Content-Type": "text/json; charset=utf-8" });
                    res.end(JSON.stringify({ screenshot, fileType: "png", url: bodyJson.url }));
                } catch (err) {
                    res.writeHead(500, { "Content-Type": "text/json; charset=utf-8" });
                    return res.end(JSON.stringify({ error: typeof err === "string" ? err : 'Unexpected error. Contact admin.' }));
                }
            });
            break;
        case "GET /screenshot":
            // Extract the requested file name from the URL
            const fileName = pathWithoutQuery?.split("/")?.slice(2, 3)?.toString();
            const filePath = path.join(IMG_DIRECTORY, fileName);

            // Check if the file exists
            fs.stat(filePath, (err, stats) => {
                if (err || !stats.isFile()) {
                    // File not found
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '404 Not Found' }));
                    return;
                }
                // Set the correct content type for the image
                const ext = path.extname(fileName).toLowerCase();
                let contentType = 'application/octet-stream';
                if (ext === '.jpg' || ext === '.jpeg') {
                    contentType = 'image/jpeg';
                } else if (ext === '.png') {
                    contentType = 'image/png';
                } else if (ext === '.gif') {
                    contentType = 'image/gif';
                }
                // Read and serve the image
                res.writeHead(200, { 'Content-Type': contentType });
                const readStream = fs.createReadStream(filePath);
                readStream.pipe(res);
            });
            break;
        default:
            res.writeHead(404);
            return res.end();
    };
});
server.listen(PORT, () => {
    console.log(
        "Server is running. Get screenshot by : GET http://localhost:" + PORT
    );
    console.log("Press Ctrl + C to quit.");
});


async function generateScreenshot(url, options) {
    let imageUrl;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    let viewport;
    if (options.width && options.height) {
        viewport = { width: options.width, height: options.height }
    }
    const page = await context.newPage({ viewport });
    await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });
    if (!fs.existsSync(IMG_DIRECTORY)) {
        fs.mkdirSync(IMG_DIRECTORY, { recursive: true });
    }
    let fileType = options?.fileType || DEFAULT_FILETYPE;
    if (!SUPPORTED_FILETYPES.includes(fileType)) {
        console.error("Requested file type is not supported. Now creating default type instead: " + DEFAULT_FILETYPE);
        fileType = DEFAULT_FILETYPE;
    }
    const filepath = path.join(IMG_DIRECTORY, `${Date.now()}.${fileType}`);
    let clip;
    if (options.clip) {
        clip = options.clip;
    }
    // if (viewport?.width && !clip?.width) {
    //     // Clip image from top left corner until the viewport size
    //     if (!clip) clip = { x: 0, y: 0 };
    //     clip.width = viewport.width;
    //     clip.height = viewport.height;
    // }
    const image = await page.screenshot({
        path: filepath,
        scale: "css", // 1 px per css px
        type: options?.fileType || DEFAULT_FILETYPE,
        clip
    });
    if (!image) {
        throw new Error("Image not created");
    }
    imageUrl = SITE_URL + "/screenshot/" + path.basename(filepath);
    if (!options?.storageService || options?.storageService === "local") {
        return imageUrl;
    }
    try {
        const cloudUploadResponse = await uploadToCloud(filepath);
        if (cloudUploadResponse) {
            deleteFile(filepath);
        }
        return cloudUploadResponse
    } catch (err) {
        return imageUrl;
    }
}

function deleteFile(fiepath) {
    fs.unlink(filepath, err => {
        if (err) console.error("Failed to delete local file:", err);
        else console.log("File deleted");
    });
}

async function uploadToCloud(filepath, cloudService) {
    switch (cloudService) {
        case "cloudinary":
            const result = await cloudinary.uploader.upload(filepath, {
                public_id: imageId,
                folder: options.cloudinaryFolder || 'default_folder'
            })
            return result;
        case "s3":
            throw new Error("S3 cloud service is not implemented yet")
        default:
            throw new Error("Please specify a cloud service")
    }
}

export function parseUrlQueryParams(urlString) {
    if (!urlString) return urlString;
    try {
        const url = new URL(urlString);
        const params = new URLSearchParams(url.search);
        return Object.fromEntries(params.entries());
    } catch (err) {
        console.error(err);
        return
    }
}

export function queryStringToJson(str) {
    if (!str) {
        return {};
    }
    return str.split("&").reduce((result, item) => {
        const parts = item.split("=");
        const key = decodeURIComponent(parts[0]);
        const value = parts.length > 1 ? decodeURIComponent(parts[1]) : "";
        result[key] = value;
        return result;
    }, {});
}

function isValidUrl(urlString) {
    try {
        new URL(urlString);
        return true; // URL is valid
    } catch (error) {
        return false; // URL is invalid
    }
}