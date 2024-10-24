import http from 'http';
import url from "url";
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { v2 as cloudinary } from "cloudinary";

const SCREENSHOT_FOLDER_NAME = "screenshots";
const IMG_DIRECTORY = process.env.IMG_DIRECTORY || path.join(process.cwd(), SCREENSHOT_FOLDER_NAME);
const SITE_URL = process.env.SITE_URL || "http://localhost:3000";
const PORT = process.env.PORT || 3000;
const SUPPORTED_FILETYPES = ["png", "jpeg"];
const DEFAULT_FILETYPE = "png";

cloudinary.config({
    secure: true,
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
})
console.log("Cloudinary configs: " + JSON.stringify(cloudinary.config()));

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
         * Body: { url: "https://original.url.to.screenshot", fileType?: "png", storageService?: "cloudinary", width?: 1200, height?: 630, clip?: { x: 0, y: 0 }, imageId: "same_id_image_gets_replaced", folder: "to_categorize" }
         * Response: { screenshot: "https://screenshot.url.permalink", fileType: "png", source: "https://original.url.to.screenshot", uploadInfo?: { ...additionalCloudUploadInfo } }
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
                    const { url, imageId, folder, storageService, fileType, clip, width, height, workspace } = bodyJson;
                    const { screenshot, uploadInfo, fileType: fileTypeReceived, source, workspace: workspaceSaved } = await generateScreenshot(url, { imageId, folder, storageService, fileType, clip, width, height, workspace });
                    console.log("Successfully generated screenshot for: " + source);
                    console.log("                                  ==>: " + screenshot);
                    res.writeHead(200, { "Content-Type": "text/json; charset=utf-8" });
                    res.end(JSON.stringify({ screenshot, fileType: fileTypeReceived, source, uploadInfo, workspace: workspaceSaved }));
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


/**
 * 
 * @param {string} url - Generate screeshot of this url
 * @param {Object} options
 * @param {string} [options.width] - The width of the screenshot
 * @param {string} [options.height] - The height of the screenshot
 * @param {string} [options.fileType] - The file type of the screenshot e.g. jpg, png
 * @param {string} [options.storageService] - Store the generated screenshot in this (cloud) storage service e.g. cloudinary, s3, local, etc.
 * @param {string} [options.imageId] - Unique image id. The image with same id in the same workspace gets replaced.
 * @param {string} [options.workspace] - Separate screenshots for different websites/services, default is 
 * @param {string} [options.folder] - Sub folder inside the workspace where the image need to be stored
 * @param {Object} [options.clip] - Use it to capture a part of the page. When not present, captures the full page.
 * @param {Object} [options.clip.x] - Start capture from this x coordinate
 * @param {Object} [options.clip.y] - Start capture from this y coordinate
 * @param {Object} [options.clip.width] - Captured screenshot width (default is options.width)
 * @param {Object} [options.clip.height] - Captured screenshot height (default is options.width)
 * @returns 
 */
async function generateScreenshot(url, options) {
    let imageUrl; // SITE_URL/screenshot/filename
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    let viewport;
    if (options.width && options.height) {
        viewport = { width: Number(options.width), height: Number(options.height) }
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
    const filenameWithoutExtension = Date.now().toString();
    const workspace = options.workspace || new URL(url).hostname;
    const filePath = path.join(IMG_DIRECTORY, workspace || "", options.folder || "", filenameWithoutExtension + "." + fileType);
    let clip;
    if (options.clip) {
        clip = options.clip;
    }
    if (viewport?.width && !clip?.width) {
        // Clip image from top left corner until the viewport size
        if (!clip) clip = { x: 0, y: 0 };
        clip.width = viewport.width;
        clip.height = viewport.height;
    }
    if (clip) {
        // Clip accepts only number
        if (clip.x) clip.x = Number(clip.x);
        if (clip.y) clip.y = Number(clip.y);
        if (clip.width) clip.width = Number(clip.width);
        if (clip.height) clip.height = Number(clip.height);
    }
    const image = await page.screenshot({
        path: filePath,
        scale: "css", // 1 px per css px
        type: options?.fileType || DEFAULT_FILETYPE,
        clip
    });
    if (!image) {
        throw new Error("Image not created");
    }
    imageUrl = SITE_URL + "/screenshot/" + path.basename(filePath);
    if (!options?.storageService || options?.storageService === "local") {
        return { screenshot: imageUrl, fileType, source: url };
    }
    try {
        const cloudUploadResponse = await uploadToCloud(filePath, {
            storageService: options?.storageService,
            imageId: options?.imageId || filenameWithoutExtension,
            workspace: workspace,
            folder: options?.folder
        });
        if (cloudUploadResponse) {
            deleteFile(filePath);
        }
        return { screenshot: cloudUploadResponse?.permalink, fileType, uploadInfo: cloudUploadResponse?.uploadInfo, source: url }
    } catch (err) {
        console.error("Failed to upload image to cloud service");
        return { screenshot: imageUrl, fileType, source: url };
    }
}

function deleteFile(filePath) {
    fs.unlink(filePath, err => {
        if (err) console.error("Failed to delete local file:", err);
        else console.log("File deleted");
    });
}

async function uploadToCloud(filePath, options) {
    switch (options?.storageService?.toLowerCase()) {
        case "cloudinary":
            const result = await cloudinary.uploader.upload(filePath, {
                public_id: options?.imageId,
                folder: (options?.workspace || "") + (options?.folder || "default_folder")
            })
            return { permalink: result?.secure_url, uploadInfo: result, source: filePath };
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