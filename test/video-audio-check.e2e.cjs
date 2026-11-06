'use strict';
// Run the same controls against a video with an audio track.
process.env.YAN_TEST_VIDEO_AUDIO = '1';
require('./attachment-video.e2e.cjs');
