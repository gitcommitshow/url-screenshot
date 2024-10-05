# url-screenshot
Url to screenshot image

A microservice to generate preview image for web pages

## Installation

Set the configurations as per `env.sample`.
The most important one is `SITE_URL`, if not set correctly, you might not be able to access the images saved locally. No trailing slash please.

## Usage

To generate screenshot, use following API

```
POST /screenshot
{
    url: "https://original.url.to.screenshot",
    fileType?: "png",
    storageService?: "cloudinary", // Upload image here after generation, saves to "local" filesystem if not provided
    width?: 1200, 
    height?: 630,
    clip?: { x: 0, y: 0 } // The point on page where to clip the screenshot from
}
```

Returns the response in following format

```
{
    screenshot: "https://screenshot.url.permalink",
    fileType: "png",
    source: "https://original.url.to.screenshot",
    uploadInfo?: { ...additionalCloudUploadInfo }
}
```

A sample `curl` request to generate screenshot for `https://gitcommit.show/`

```bash
curl http://localhost:3000/screenshot -X POST -d '{ "url": "https://gitcommit.show/", "storageService":"cloudinary", "imageId": "test-overwrite", "width": "1200", "height": "630" }'
```

## Features

- [x] Generate preview image
- [ ] Upload image to a cloud service
    - [ ] Cloudinary
    - [ ] AWS S3
