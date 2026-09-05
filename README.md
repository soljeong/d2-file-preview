# D2 File Preview

D2 File Preview lets you edit `.d2` files in Obsidian and automatically renders sibling SVG previews.

Rendering runs locally and offline through the bundled D2.js/WebAssembly engine. A separate D2 executable is not required.

## Platform support

- Windows, macOS, and Linux are supported.
- Android is supported and has been verified on a Samsung SM-T875N running Android 13 with Obsidian 1.13.8. The physical-device check passed simple render, edit/save refresh, vault-local relative import, and cold-start worker initialization.
- iOS/iPadOS is not tested on a physical device yet, although installation is enabled. Please treat iOS/iPadOS support as unverified and report any worker, rendering, or preview issues.

## Usage

1. Run **Create new D2 file** from the Command Palette to create an empty `Untitled.d2` file, or open an existing `.d2` file.
2. Edit the D2 source.
3. After one second without additional edits, the plugin creates or overwrites a sibling `.svg` file with the same base name.
4. After the first successful render, the SVG opens in a preview. Later successful renders reuse and refresh that preview.

If rendering fails, the plugin shows a short notice and writes details to the developer console. The last successfully generated SVG remains unchanged, and rendering is retried after the next source edit.

## Imports

D2 imports between `.d2` files inside the current vault are supported, including relative imports. Imports outside the current vault are not supported.

To let D2 resolve imports itself, the plugin supplies the vault's `.d2` files to the bundled renderer for each render. Very large vaults containing many D2 files may therefore take longer to render.

## Upgrading from 1.0.x

The plugin no longer uses a system D2 executable. The former **D2 executable path** setting has been removed; any previously saved value is ignored.

## MVP scope

The plugin does not include a dedicated D2 editor, render-options UI, manual Render command, ribbon/context-menu actions, or automatic SVG cleanup after D2 rename/delete operations.

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the bundled D2.js dependency.
