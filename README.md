# D2 File Preview

D2 File Preview is a desktop-only Obsidian plugin for editing `.d2` source files and automatically rendering sibling SVG previews.

## Requirements

This plugin does not bundle D2. Install the D2 CLI separately and make the `d2` executable available on `PATH`, or set an explicit path in **Settings → D2 File Preview → D2 executable path**.

The plugin launches that local D2 executable as an external process. The executable itself may be located outside your Obsidian vault. Diagram input and generated SVG output are limited to files in the current filesystem-backed vault.

## Usage

1. Run **Create new D2 file** from the Command Palette to create an empty `Untitled.d2` file.
2. Edit the D2 source file.
3. After one second without additional edits, the plugin runs the D2 CLI and creates or overwrites a sibling `.svg` file with the same base name.
4. After the first successful render, the SVG opens in a split view. Later successful renders reuse and refresh that preview.

If rendering fails, the plugin shows a short notice and writes detailed information to the developer console. The last successfully generated SVG remains unchanged, and rendering is retried after the next source edit.

## Platform support

Desktop Obsidian only: Windows, macOS, and Linux. Mobile is not supported because the plugin relies on the local filesystem and an external executable.

## MVP scope

The MVP does not include a dedicated D2 editor, render-options UI, manual Render command, ribbon/context-menu actions, or automatic SVG cleanup after D2 rename/delete operations.

## License

MIT
