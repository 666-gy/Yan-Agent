'use strict';

// Editor intent travels with attachments through drafts, queues and recovery.
function imageEditContext(attachments, workspace = '') {
  const images = (Array.isArray(attachments) ? attachments : []).filter(item =>
    item?.path && ['source', 'annotation', 'selection'].includes(item.imageEdit));
  if (!images.length) return '';
  const source = images.find(item => item.imageEdit === 'selection')
    || images.find(item => item.imageEdit === 'annotation') || images[0];
  return [
    'Yan image-editor request: perform the requested visual edit through Yan Media MCP using the configured image model.',
    'Call yan_media_generate_image with source_path set to the exact preferred source below and workspace set to this turn’s workspace. These are existing images to edit, not a request to programmatically redraw them.',
    JSON.stringify({ workspace, preferred_source_path: source.path,
      images: images.map(item => ({ path: item.path, role: item.imageEdit })) }),
    'For annotation images, circles, arrows, handwriting and added labels are edit guidance. For selection images, the translucent painted overlay identifies the area to remove. Interpret those cues with the user’s written request and remove the guidance marks from the final image unless the user explicitly asks to keep them. Preserve unrelated content. If visible details are unknown, use yan_media_read_image first; carry the complete requested changes into the image-model prompt.',
    'Do not substitute Python, Pillow, OpenCV, ImageMagick, SVG or Canvas scripts for this edit unless the user explicitly requests a code-based editing method. If Yan Media is deferred, activate yan_media through yan_mcp_activate_mcp_server. If no image model is configured, the tool is unavailable or editing fails, explain the concrete problem; do not silently fall back to scripts or claim completion. The current text model remains the conversation owner and summarizes the successful media result.'
  ].join('\n');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { imageEditContext };
else window.YanImageEditContext = imageEditContext;
