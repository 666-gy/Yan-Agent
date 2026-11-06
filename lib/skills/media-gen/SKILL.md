---
name: media-gen
description: Generate or revise video using Yan’s configured video model. Use for text-to-video and revisions of prior Yan video generations.
---

# Media Gen

Call native tool yan_media_generate_video with the subject, action, scene, camera, style, duration_seconds, aspect_ratio and resolution supported by its schema. Use source_asset_id to revise a previous generated video brief. Image-to-video is not currently exposed by this tool; do not promise it. Read the actual tool schema before calling; never invent unsupported inputs. Report returned assets and failures accurately. If the tool is absent, ask the user to configure a video model in Yan. Use Media Use for finding/editing existing assets, and HyperFrames/Remotion for programmatic compositions.
