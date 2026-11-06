---
name: image-gen
description: Generate or edit raster images using Yan’s configured image model. Use for image creation, revisions, supplied-image edits, illustrations, textures and image assets.
---

# Image Gen

Read the user brief and preserve unspecified details in revisions. Call the native tool yan_media_generate_image with a complete prompt and aspect_ratio. For a prior generated image use source_asset_id; for an uploaded/local image use source_path. The host binds workspace access. Never invent asset IDs. A successful result is evidence of generation: show the returned asset and summarize the result. Do not automatically call read_image after successful generation. If the tool is absent, ask the user to configure an image model in Yan. Do not substitute code-generated drawings unless requested.
