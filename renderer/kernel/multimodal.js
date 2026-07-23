/* Yan Agent - multimodal user message builder */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

  function isImageAttachment(attachment = {}) {
    if (attachment.kind === 'image') return true;
    if (/^image\//i.test(String(attachment.mimeType || ''))) return true;
    return /\.(?:png|jpe?g|webp|gif)$/i.test(String(attachment.name || attachment.path || ''));
  }

  function selectedSkills(message) {
    const source = Array.isArray(message?.skillCalls)
      ? message.skillCalls
      : (message?.skillCall?.id ? [message.skillCall] : []);
    const seen = new Set();
    return source.filter(skill => {
      const id = String(skill?.id || '').trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function applySelectedSkills(message, taskText) {
    const skills = selectedSkills(message);
    if (!skills.length) return taskText;
    const instructions = [];
    if (taskText) instructions.push(`用户当前请求：\n${taskText}`);
    instructions.push(...skills.map(skill => {
      const name = String(skill.name || skill.id);
      const playbook = String(skill.prompt || '').trim();
      if (playbook) {
        return [
          `用户已明确启用 Skill「${name}」(${skill.id})。以下是该 Skill 的完整 playbook，必须与其他已选 Skill 一并遵循：`,
          playbook
        ].join('\n\n');
      }
      return `用户已明确启用 Skill「${name}」(${skill.id})。先调用 read_skill 读取其完整 playbook，再按其中步骤执行。`;
    }));
    return instructions.join('\n\n---\n\n');
  }

  async function buildApiMessageContent(message = {}, modelCapabilities = {}) {
    let text = applySelectedSkills(message, String(message.content || ''));
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (!attachments.length) return text;

    const textParts = [];
    const imageParts = [];
    for (const attachment of attachments) {
      const name = String(attachment.name || '附件');
      if (isImageAttachment(attachment)) {
        if (!modelCapabilities.vision) {
          textParts.push(`【图片: ${name}】(当前模型不支持图像输入，未发送图片内容)`);
          continue;
        }
        try {
          const result = await api().readImageAttachment(attachment.path);
          if (result?.error) {
            textParts.push(`【图片: ${name}】(无法读取: ${result.error})`);
          } else if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(String(result?.dataUrl || ''))) {
            imageParts.push({ type: 'image_url', image_url: { url: result.dataUrl } });
          } else {
            textParts.push(`【图片: ${name}】(图片数据格式无效)`);
          }
        } catch (error) {
          textParts.push(`【图片: ${name}】(无法读取: ${error.message})`);
        }
        continue;
      }

      try {
        const result = await api().readFile(attachment.path);
        if (result?.error) textParts.push(`【附件: ${name}】(无法读取: ${result.error})`);
        else if (result?.isBinary) textParts.push(`【附件: ${name}】(二进制文件，${result.size} 字节，未内联)`);
        else if (result?.content != null) {
          const clipped = result.content.length > 8000
            ? result.content.slice(0, 8000) + '\n...(内容过长已截断)...'
            : result.content;
          textParts.push(`【附件: ${name}】\n\`\`\`\n${clipped}\n\`\`\``);
        }
      } catch (error) {
        textParts.push(`【附件: ${name}】(无法读取: ${error.message})`);
      }
    }

    if (textParts.length) text = (text ? text + '\n\n' : '') + textParts.join('\n\n');
    if (!imageParts.length) return text;
    return [
      { type: 'text', text: text || '请分析这些图像并结合当前任务处理。' },
      ...imageParts
    ];
  }

  K.isImageAttachment = isImageAttachment;
  K.buildApiMessageContent = buildApiMessageContent;
})(window.YanKernel);
