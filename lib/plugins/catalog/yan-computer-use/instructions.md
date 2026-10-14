# Yan Computer Use

Use this plugin for Windows desktop application tasks. Its tools use Cua Driver 0.34.0.
Read the enabled `computer-use` skill through `plugins_read_resource` with
resource `skill:computer-use` before operating. When it is disabled, do not load
its instructions through other file tools. Follow the existing plugin skill policy.
Discover the exact application and window, read fresh window state, then act using
the returned tool schemas. Prefer element tokens and background delivery. A new
snapshot invalidates previous tokens. Screenshot coordinates refer to that exact
capture; the driver handles screenshot-to-screen scaling.

Check fresh state after actions. Delivery alone is not success. If background
input has no effect, inspect the new state before choosing another delivery mode.
Refusals do not authorize escalation. Verify the target and text before sending
messages, and verify the resulting UI afterward. Never repeat a delivered send
without checking whether it already succeeded.

Image input follows the user's existing model capability configuration. When the
model cannot accept images, use the accessibility tree and local screenshot paths;
use the existing yan_media_read_image for visual interpretation when configured.
Do not create another vision backend or guess capabilities from model names.
Ordinary web browsing continues to use Yan Built-in Browser.
