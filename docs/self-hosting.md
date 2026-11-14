# Self-hosting with Docker

Running your own copy of CardiPaw. For the quick start see the [README](../README.md#docker).

The app is available as a pre-built image on Docker Hub: [wesleyegbertsen/cardipaw](https://hub.docker.com/r/wesleyegbertsen/cardipaw)

## docker run

```bash
docker run -d -p 8080:80 --name cardipaw wesleyegbertsen/cardipaw:latest
```

Then open `http://localhost:8080`.

## docker-compose

```yaml
services:
  cardipaw:
    image: wesleyegbertsen/cardipaw:latest
    container_name: cardipaw
    ports:
      - "8080:80"
    restart: unless-stopped
```

Behind your own web server instead of the image? Serve `index.html` at `/share` (share links are `/share#d=…`; the page moves itself to `/#/share`). The nginx.conf in the image shows how. Android only opens share links from cardipaw.com in the app, so this does not change which links the app claims.

Every release is also published under its version, e.g. `wesleyegbertsen/cardipaw:1.4.2`, plus floating `:1.4` and `:1` tags. Pin one of those instead of `latest` if you want to control when you upgrade.
