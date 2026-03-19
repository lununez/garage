/**
 * Font Manager for LVGL Visual Designer
 * Manages ESPHome LVGL font declarations: name, size, file/family, glyphs.
 *
 * ESPHome font YAML format:
 *   font:
 *     - file: "gfonts://Roboto"
 *       id: roboto_24
 *       size: 24
 *       glyphs: ...
 *     - file: "fonts/materialdesignicons-webfont.ttf"
 *       id: mdi_18
 *       size: 18
 *       glyphs: "\U000F0001-\U000F1AF0"
 */

const FontManager = (() => {

    // Default fonts always available (LVGL built-ins)
    const BUILTIN_FONTS = [
        { id: 'montserrat_10', size: 10, builtin: true, label: 'Montserrat 10' },
        { id: 'montserrat_12', size: 12, builtin: true, label: 'Montserrat 12' },
        { id: 'montserrat_14', size: 14, builtin: true, label: 'Montserrat 14' },
        { id: 'montserrat_16', size: 16, builtin: true, label: 'Montserrat 16' },
        { id: 'montserrat_18', size: 18, builtin: true, label: 'Montserrat 18' },
        { id: 'montserrat_20', size: 20, builtin: true, label: 'Montserrat 20' },
        { id: 'montserrat_22', size: 22, builtin: true, label: 'Montserrat 22' },
        { id: 'montserrat_24', size: 24, builtin: true, label: 'Montserrat 24' },
        { id: 'montserrat_28', size: 28, builtin: true, label: 'Montserrat 28' },
        { id: 'montserrat_32', size: 32, builtin: true, label: 'Montserrat 32' },
        { id: 'montserrat_36', size: 36, builtin: true, label: 'Montserrat 36' },
        { id: 'montserrat_48', size: 48, builtin: true, label: 'Montserrat 48' },
    ];

    // Common Google Fonts families for the picker
    const GOOGLE_FONTS = [
        'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Oswald',
        'Raleway', 'Poppins', 'Noto Sans', 'Ubuntu', 'Playfair Display',
        'Merriweather', 'Roboto Condensed', 'Source Sans Pro', 'Roboto Mono',
        'Inconsolata', 'Fira Code',
    ];

    // Common glyph range presets
    const GLYPH_PRESETS = {
        'ASCII': '0x20-0x7E',
        'Latin Extended': '0x20-0x24F',
        'MDI Icons': '\\U000F0001-\\U000F1AF0',
        'Digits Only': '0x30-0x39',
        'Custom': '',
    };

    // Project fonts (user-defined)
    let projectFonts = [];

    // Change listeners
    let onChangeCallbacks = [];

    function init(fonts) {
        projectFonts = Array.isArray(fonts) ? fonts.map(f => ({ ...f })) : [];
        loadGoogleFontsForPreview();
    }

    function getProjectFonts() {
        return projectFonts.slice();
    }

    function getBuiltinFonts() {
        return BUILTIN_FONTS.slice();
    }

    function getAllFonts() {
        return [...BUILTIN_FONTS, ...projectFonts];
    }

    function getFontById(id) {
        return getAllFonts().find(f => f.id === id) || null;
    }

    function addFont(font) {
        if (!font.id || !font.size) return false;
        // Don't allow duplicating builtin IDs
        if (BUILTIN_FONTS.some(b => b.id === font.id)) return false;
        // Don't allow duplicate IDs
        if (projectFonts.some(f => f.id === font.id)) return false;
        projectFonts.push({ ...font });
        notifyChange();
        return true;
    }

    function updateFont(id, updates) {
        const font = projectFonts.find(f => f.id === id);
        if (!font) return false;
        // If renaming, check for conflicts
        if (updates.id && updates.id !== id) {
            if (getAllFonts().some(f => f.id === updates.id)) return false;
        }
        Object.assign(font, updates);
        notifyChange();
        return true;
    }

    function removeFont(id) {
        const idx = projectFonts.findIndex(f => f.id === id);
        if (idx < 0) return false;
        projectFonts.splice(idx, 1);
        notifyChange();
        return true;
    }

    function onChange(cb) {
        onChangeCallbacks.push(cb);
    }

    function notifyChange() {
        loadGoogleFontsForPreview();
        for (const cb of onChangeCallbacks) cb(projectFonts);
    }

    /**
     * Load Google Fonts used by project fonts into the browser for canvas preview.
     */
    const loadedFamilies = new Set();
    function loadGoogleFontsForPreview() {
        const families = projectFonts
            .filter(f => f.family && !loadedFamilies.has(f.family))
            .map(f => f.family);
        if (families.length === 0) return;
        for (const family of families) {
            loadedFamilies.add(family);
        }
        const url = 'https://fonts.googleapis.com/css2?'
            + families.map(f => `family=${encodeURIComponent(f)}:wght@400;700`).join('&')
            + '&display=swap';
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
    }

    /**
     * Generate CSS font-size (and optionally font-family) for a given font ID.
     * Used by the renderer to preview fonts on canvas.
     */
    function getFontCSS(fontId) {
        const font = getFontById(fontId);
        if (!font) {
            // Try extracting size from ID pattern like "roboto_24"
            const m = String(fontId).match(/(\d+)/);
            return m ? { fontSize: m[1] + 'px' } : {};
        }
        const css = { fontSize: font.size + 'px' };
        if (font.family) {
            css.fontFamily = `'${font.family}', sans-serif`;
        }
        return css;
    }

    /**
     * Convert project fonts to ESPHome font YAML objects.
     */
    function toYAML() {
        if (projectFonts.length === 0) return null;
        return projectFonts.map(f => {
            const obj = {};
            if (f.file) {
                obj.file = f.file;
            } else if (f.family) {
                obj.file = `gfonts://${f.family}`;
            }
            obj.id = f.id;
            obj.size = f.size;
            if (f.bpp) obj.bpp = f.bpp;
            if (f.glyphs) obj.glyphs = f.glyphs;
            if (f.extras && f.extras.length > 0) {
                obj.extras = f.extras;
            }
            return obj;
        });
    }

    /**
     * Parse ESPHome font YAML array into project fonts.
     */
    function fromYAML(fontArray) {
        if (!Array.isArray(fontArray)) return;
        projectFonts = [];
        for (const f of fontArray) {
            const font = {
                id: f.id,
                size: f.size || 14,
            };
            if (f.file) {
                const gfontsMatch = String(f.file).match(/^gfonts:\/\/(.+)/);
                if (gfontsMatch) {
                    font.family = gfontsMatch[1];
                } else {
                    font.file = f.file;
                }
            }
            if (f.bpp) font.bpp = f.bpp;
            if (f.glyphs) font.glyphs = f.glyphs;
            if (f.extras) font.extras = f.extras;
            font.label = font.family
                ? `${font.family} ${font.size}`
                : `${font.id} (${font.size}px)`;
            projectFonts.push(font);
        }
        notifyChange();
    }

    // ---- Font Manager Modal UI ----

    function showModal() {
        let modal = document.getElementById('font-manager-modal');
        if (!modal) {
            modal = createModal();
            document.body.appendChild(modal);
        }
        renderFontList();
        modal.classList.remove('hidden');
    }

    function hideModal() {
        const modal = document.getElementById('font-manager-modal');
        if (modal) modal.classList.add('hidden');
    }

    function createModal() {
        const modal = document.createElement('div');
        modal.id = 'font-manager-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:600px;">
                <div class="modal-header">
                    <span>Font Manager</span>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body" style="padding:0;">
                    <div id="font-manager-list" style="max-height:300px;overflow-y:auto;padding:12px;"></div>
                    <div id="font-add-form" style="padding:12px;border-top:1px solid var(--border-color);">
                        <div style="font-weight:600;margin-bottom:8px;font-size:12px;">Add New Font</div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
                            <div>
                                <label style="font-size:11px;color:var(--text-secondary);">Font Source</label>
                                <select id="font-source" style="width:100%;font-size:12px;">
                                    <option value="google">Google Font</option>
                                    <option value="file">Local File</option>
                                </select>
                            </div>
                            <div id="font-family-group">
                                <label style="font-size:11px;color:var(--text-secondary);">Family</label>
                                <select id="font-family-select" style="width:100%;font-size:12px;">
                                    ${GOOGLE_FONTS.map(f => `<option value="${f}">${f}</option>`).join('')}
                                </select>
                            </div>
                            <div id="font-file-group" style="display:none;">
                                <label style="font-size:11px;color:var(--text-secondary);">File Path</label>
                                <input type="text" id="font-file-path" placeholder="fonts/my-font.ttf" style="width:100%;font-size:12px;">
                            </div>
                            <div>
                                <label style="font-size:11px;color:var(--text-secondary);">Font ID</label>
                                <input type="text" id="font-new-id" placeholder="e.g. roboto_24" style="width:100%;font-size:12px;">
                            </div>
                            <div>
                                <label style="font-size:11px;color:var(--text-secondary);">Size (px)</label>
                                <input type="number" id="font-new-size" value="16" min="6" max="128" style="width:100%;font-size:12px;">
                            </div>
                            <div>
                                <label style="font-size:11px;color:var(--text-secondary);">BPP</label>
                                <select id="font-new-bpp" style="width:100%;font-size:12px;">
                                    <option value="">Default (4)</option>
                                    <option value="1">1</option>
                                    <option value="2">2</option>
                                    <option value="4">4</option>
                                    <option value="8">8</option>
                                </select>
                            </div>
                        </div>
                        <div style="margin-bottom:8px;">
                            <label style="font-size:11px;color:var(--text-secondary);">Glyphs</label>
                            <div style="display:flex;gap:4px;margin-bottom:4px;">
                                <select id="font-glyph-preset" style="flex:1;font-size:11px;">
                                    ${Object.keys(GLYPH_PRESETS).map(k => `<option value="${k}">${k}</option>`).join('')}
                                </select>
                            </div>
                            <input type="text" id="font-new-glyphs" placeholder="e.g. 0x20-0x7E or leave empty for default" style="width:100%;font-size:12px;">
                        </div>
                        <div style="margin-bottom:8px;">
                            <label style="font-size:11px;color:var(--text-secondary);">MDI Extras (optional)</label>
                            <input type="text" id="font-new-extras-glyphs" placeholder="e.g. \\U000F0001-\\U000F1AF0" style="width:100%;font-size:12px;">
                        </div>
                        <button id="btn-font-add" style="width:100%;font-size:12px;">+ Add Font</button>
                    </div>
                </div>
            </div>`;

        // Close button
        modal.querySelector('.modal-close').addEventListener('click', hideModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal();
        });

        // Source toggle
        const sourceSelect = modal.querySelector('#font-source');
        sourceSelect.addEventListener('change', () => {
            const isFile = sourceSelect.value === 'file';
            modal.querySelector('#font-family-group').style.display = isFile ? 'none' : '';
            modal.querySelector('#font-file-group').style.display = isFile ? '' : 'none';
        });

        // Auto-generate ID from family + size
        const familySelect = modal.querySelector('#font-family-select');
        const sizeInput = modal.querySelector('#font-new-size');
        const idInput = modal.querySelector('#font-new-id');
        function autoId() {
            if (sourceSelect.value === 'google') {
                const family = familySelect.value.toLowerCase().replace(/\s+/g, '_');
                idInput.value = `${family}_${sizeInput.value}`;
            }
        }
        familySelect.addEventListener('change', autoId);
        sizeInput.addEventListener('input', autoId);
        autoId();

        // Glyph preset
        const glyphPreset = modal.querySelector('#font-glyph-preset');
        const glyphInput = modal.querySelector('#font-new-glyphs');
        glyphPreset.addEventListener('change', () => {
            const val = GLYPH_PRESETS[glyphPreset.value];
            if (val) glyphInput.value = val;
        });

        // Add button
        modal.querySelector('#btn-font-add').addEventListener('click', () => {
            const source = sourceSelect.value;
            const font = {
                id: idInput.value.trim(),
                size: parseInt(sizeInput.value) || 14,
            };
            if (source === 'google') {
                font.family = familySelect.value;
            } else {
                font.file = modal.querySelector('#font-file-path').value.trim();
            }
            const bpp = modal.querySelector('#font-new-bpp').value;
            if (bpp) font.bpp = parseInt(bpp);
            const glyphs = glyphInput.value.trim();
            if (glyphs) font.glyphs = glyphs;

            // Handle MDI extras
            const extrasGlyphs = modal.querySelector('#font-new-extras-glyphs').value.trim();
            if (extrasGlyphs) {
                font.extras = [{
                    file: 'matdsgn2',
                    glyphs: extrasGlyphs,
                }];
            }

            font.label = font.family
                ? `${font.family} ${font.size}`
                : `${font.id} (${font.size}px)`;

            if (!font.id) {
                alert('Font ID is required');
                return;
            }
            if (addFont(font)) {
                renderFontList();
                // Reset form
                idInput.value = '';
                glyphInput.value = '';
                modal.querySelector('#font-new-extras-glyphs').value = '';
                autoId();
            } else {
                alert('Font ID already exists or is invalid');
            }
        });

        return modal;
    }

    function renderFontList() {
        const listEl = document.getElementById('font-manager-list');
        if (!listEl) return;

        let html = '';

        // Builtin fonts
        html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;font-weight:600;">Built-in Fonts (LVGL)</div>';
        for (const f of BUILTIN_FONTS) {
            html += `<div class="font-item builtin">
                <span class="font-item-name">${f.label}</span>
                <span class="font-item-id">${f.id}</span>
            </div>`;
        }

        // Project fonts
        html += '<div style="font-size:11px;color:var(--text-secondary);margin:12px 0 4px;font-weight:600;">Project Fonts</div>';
        if (projectFonts.length === 0) {
            html += '<div style="font-size:11px;color:var(--text-secondary);padding:8px;text-align:center;">No project fonts defined. Add one below.</div>';
        }
        for (const f of projectFonts) {
            const source = f.family ? `gfonts://${f.family}` : (f.file || '?');
            html += `<div class="font-item project">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="font-item-name">${f.label || f.id}</span>
                    <button class="font-remove-btn" data-font-id="${f.id}" title="Remove">&times;</button>
                </div>
                <div style="font-size:10px;color:var(--text-secondary);">
                    ID: ${f.id} | Size: ${f.size}px | Source: ${source}
                    ${f.glyphs ? ' | Glyphs: ' + f.glyphs : ''}
                    ${f.extras ? ' | +extras' : ''}
                </div>
            </div>`;
        }

        listEl.innerHTML = html;

        // Remove buttons
        listEl.querySelectorAll('.font-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.fontId;
                if (confirm(`Remove font "${id}"?`)) {
                    removeFont(id);
                    renderFontList();
                }
            });
        });
    }

    return {
        init,
        getProjectFonts,
        getBuiltinFonts,
        getAllFonts,
        getFontById,
        addFont,
        updateFont,
        removeFont,
        getFontCSS,
        toYAML,
        fromYAML,
        showModal,
        hideModal,
        onChange,
        GOOGLE_FONTS,
        GLYPH_PRESETS,
    };
})();
