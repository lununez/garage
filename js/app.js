/**
 * LVGL Visual Designer - Main Application
 * Orchestrates all modules: widget palette, designer canvas, YAML editor,
 * toolbar actions, and ensures bidirectional sync between visual and YAML.
 */

(function () {
    'use strict';

    // ---- Wait for DOM ----
    document.addEventListener('DOMContentLoaded', () => {
        initApp();
    });

    function initApp() {
        // Initialize YAML Engine
        YAMLEngine.init({
            onApply: (newState) => {
                Designer.setState(newState);
                YAMLEngine.updateEditorFromState(Designer.getState());
            },
        });

        // Initialize Designer
        Designer.init({
            onStateChange: (designerState) => {
                YAMLEngine.updateEditorFromState(designerState);
            },
        });

        // Initialize Preview Mode
        PreviewMode.init();

        // Build UI
        buildWidgetPalette();
        setupToolbarEvents();
        setupYAMLPanelEvents();
        setupModals();
        setupDisplaySizeSelector();
        setupModeToggle();

        // Ctrl+S to save
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveProject();
            }
        });

        // Auto-load last project
        autoLoadLastProject();

        // Initial YAML sync
        YAMLEngine.updateEditorFromState(Designer.getState());
    }

    function autoLoadLastProject() {
        const lastName = localStorage.getItem('lvgl-designer-last-project');
        if (!lastName) return;
        const projects = getProjects();
        if (!projects[lastName]) return;
        // Silently restore without prompts
        const proj = projects[lastName];
        Designer.setState(proj.state);

        const sizeSelect = document.getElementById('display-size');
        if (sizeSelect && proj.displaySize) {
            const match = Array.from(sizeSelect.options).find(o => o.value === proj.displaySize);
            if (match) {
                sizeSelect.value = proj.displaySize;
            } else if (proj.displaySize !== 'custom') {
                const opt = document.createElement('option');
                opt.value = proj.displaySize;
                const [w, h] = proj.displaySize.split('x');
                opt.textContent = `${w}x${h} (Custom)`;
                sizeSelect.insertBefore(opt, sizeSelect.querySelector('[value="custom"]'));
                sizeSelect.value = proj.displaySize;
            }
        }
    }

    // ---- Widget Palette ----
    function buildWidgetPalette() {
        const paletteEl = document.getElementById('widget-palette');
        if (!paletteEl) return;

        const byCategory = LVGLWidgets.getWidgetsByCategory();

        for (const [category, widgets] of Object.entries(byCategory)) {
            if (widgets.length === 0) continue;

            const catEl = document.createElement('div');
            catEl.className = 'widget-category';

            const headerEl = document.createElement('div');
            headerEl.className = 'widget-category-header expanded';
            headerEl.textContent = category;
            headerEl.addEventListener('click', () => {
                headerEl.classList.toggle('expanded');
                itemsEl.classList.toggle('expanded');
            });

            const itemsEl = document.createElement('div');
            itemsEl.className = 'widget-category-items expanded';

            for (const widget of widgets) {
                const itemEl = document.createElement('div');
                itemEl.className = 'widget-palette-item';
                itemEl.draggable = true;
                itemEl.title = widget.description;
                itemEl.innerHTML = `<span class="widget-icon">${widget.icon}</span>${widget.label}`;

                itemEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/widget-type', widget.type);
                    e.dataTransfer.effectAllowed = 'copy';

                    // Create drag preview
                    const preview = document.createElement('div');
                    preview.className = 'drag-preview';
                    preview.textContent = widget.label;
                    document.body.appendChild(preview);
                    e.dataTransfer.setDragImage(preview, 0, 0);
                    setTimeout(() => preview.remove(), 0);
                });

                // Double-click to add at center
                itemEl.addEventListener('dblclick', () => {
                    const state = Designer.getState();
                    const cx = Math.round(state.displayWidth / 2 - (LVGLWidgets.getWidgetDef(widget.type)?.defaultSize.width || 50) / 2);
                    const cy = Math.round(state.displayHeight / 2 - (LVGLWidgets.getWidgetDef(widget.type)?.defaultSize.height || 25) / 2);
                    Designer.createWidget(widget.type, cx, cy);
                });

                itemsEl.appendChild(itemEl);
            }

            catEl.appendChild(headerEl);
            catEl.appendChild(itemsEl);
            paletteEl.appendChild(catEl);
        }

        // Widget search
        const searchInput = document.getElementById('widget-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                paletteEl.querySelectorAll('.widget-palette-item').forEach(item => {
                    const text = item.textContent.toLowerCase();
                    const title = (item.title || '').toLowerCase();
                    item.style.display = (text.includes(query) || title.includes(query)) ? '' : 'none';
                });

                // Show all categories when searching
                if (query) {
                    paletteEl.querySelectorAll('.widget-category-items').forEach(el => {
                        el.classList.add('expanded');
                    });
                    paletteEl.querySelectorAll('.widget-category-header').forEach(el => {
                        el.classList.add('expanded');
                    });
                }
            });
        }
    }

    // ---- Toolbar Events ----
    function setupToolbarEvents() {
        document.getElementById('btn-undo')?.addEventListener('click', () => Designer.undo());
        document.getElementById('btn-redo')?.addEventListener('click', () => Designer.redo());
        document.getElementById('btn-delete')?.addEventListener('click', () => {
            if (Designer.selectedWidgetId) Designer.deleteWidget(Designer.selectedWidgetId);
        });
        document.getElementById('btn-duplicate')?.addEventListener('click', () => {
            if (Designer.selectedWidgetId) Designer.duplicateWidget(Designer.selectedWidgetId);
        });

        document.getElementById('btn-validate')?.addEventListener('click', () => {
            const results = YAMLEngine.validateEditorContent();
            showValidationModal(results);
        });

        document.getElementById('btn-export')?.addEventListener('click', () => {
            YAMLEngine.exportYAML(Designer.getState());
        });

        document.getElementById('btn-import')?.addEventListener('click', () => {
            document.getElementById('import-modal')?.classList.remove('hidden');
        });

        document.getElementById('btn-save')?.addEventListener('click', () => saveProject());
        document.getElementById('btn-load')?.addEventListener('click', () => showLoadModal());

        document.getElementById('btn-add-page')?.addEventListener('click', () => {
            Designer.addPage();
        });
    }

    // ---- Project Save/Load ----
    const STORAGE_KEY = 'lvgl-designer-projects';

    function getProjects() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch { return {}; }
    }

    function saveProject() {
        const projects = getProjects();
        const state = Designer.getState();
        const defaultName = state.projectName || 'Untitled';
        const name = prompt('Project name:', defaultName);
        if (!name) return;

        const sizeSelect = document.getElementById('display-size');
        projects[name] = {
            state: state,
            displaySize: sizeSelect ? sizeSelect.value : `${state.displayWidth}x${state.displayHeight}`,
            savedAt: new Date().toISOString(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));

        // Auto-save also stores last-used project name
        localStorage.setItem('lvgl-designer-last-project', name);
        showToast('Project saved: ' + name);
    }

    function loadProject(name) {
        const projects = getProjects();
        const proj = projects[name];
        if (!proj) return;

        Designer.setState(proj.state);

        // Restore display size in dropdown
        const sizeSelect = document.getElementById('display-size');
        if (sizeSelect && proj.displaySize) {
            const match = Array.from(sizeSelect.options).find(o => o.value === proj.displaySize);
            if (match) {
                sizeSelect.value = proj.displaySize;
            } else if (proj.displaySize !== 'custom') {
                // Add custom option if size isn't in presets
                const opt = document.createElement('option');
                opt.value = proj.displaySize;
                const [w, h] = proj.displaySize.split('x');
                opt.textContent = `${w}x${h} (Custom)`;
                sizeSelect.insertBefore(opt, sizeSelect.querySelector('[value="custom"]'));
                sizeSelect.value = proj.displaySize;
            }
        }

        YAMLEngine.updateEditorFromState(Designer.getState());
        localStorage.setItem('lvgl-designer-last-project', name);
        document.getElementById('load-modal')?.classList.add('hidden');
        showToast('Loaded: ' + name);
    }

    function deleteProject(name) {
        if (!confirm('Delete project "' + name + '"?')) return;
        const projects = getProjects();
        delete projects[name];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
        showLoadModal(); // refresh list
    }

    function showLoadModal() {
        const modal = document.getElementById('load-modal');
        const list = document.getElementById('saved-projects-list');
        if (!modal || !list) return;

        const projects = getProjects();
        const names = Object.keys(projects);

        if (names.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:16px;">No saved projects yet.</p>';
        } else {
            list.innerHTML = names.map(name => {
                const proj = projects[name];
                const date = proj.savedAt ? new Date(proj.savedAt).toLocaleString() : '';
                return `<div class="saved-project-item">
                    <div class="saved-project-info">
                        <strong>${escapeHtml(name)}</strong>
                        <small>${escapeHtml(proj.displaySize || '')} &middot; ${escapeHtml(date)}</small>
                    </div>
                    <div class="saved-project-actions">
                        <button onclick="AppActions.loadProject('${escapeHtml(name.replace(/'/g, "\\'"))}')">Load</button>
                        <button class="btn-danger" onclick="AppActions.deleteProject('${escapeHtml(name.replace(/'/g, "\\'"))}')">Delete</button>
                    </div>
                </div>`;
            }).join('');
        }

        modal.classList.remove('hidden');
    }

    function showToast(message) {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // Expose actions for inline onclick handlers
    window.AppActions = { loadProject, deleteProject };

    // ---- Display Size Selector ----
    function setupDisplaySizeSelector() {
        const select = document.getElementById('display-size');
        if (!select) return;

        select.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'custom') {
                const w = prompt('Width (px):', '170');
                const h = prompt('Height (px):', '320');
                if (w && h) {
                    const pw = parseInt(w), ph = parseInt(h);
                    const sizeStr = pw + 'x' + ph;
                    // Add as a selectable option so it persists in the dropdown
                    const opt = document.createElement('option');
                    opt.value = sizeStr;
                    opt.textContent = `${pw}x${ph} (Custom)`;
                    select.insertBefore(opt, select.querySelector('[value="custom"]'));
                    select.value = sizeStr;
                    Designer.setDisplaySize(pw, ph);
                    Designer.renderAll();
                } else {
                    // Revert dropdown if cancelled
                    select.value = Designer.getState().displayWidth + 'x' + Designer.getState().displayHeight;
                }
            } else {
                const [w, h] = val.split('x').map(Number);
                Designer.setDisplaySize(w, h);
                Designer.renderAll();
            }
        });
    }

    // ---- YAML Panel Events ----
    function setupYAMLPanelEvents() {
        // Apply button
        document.getElementById('btn-yaml-apply')?.addEventListener('click', () => {
            const result = YAMLEngine.applyEditorToDesigner();
            if (!result.success) {
                showValidationModal(result.results);
            }
        });

        // Format button
        document.getElementById('btn-yaml-format')?.addEventListener('click', () => {
            YAMLEngine.formatEditor();
        });

        // Toggle button
        const toggleBtn = document.getElementById('btn-yaml-toggle');
        const yamlPanel = document.getElementById('yaml-panel');
        if (toggleBtn && yamlPanel) {
            toggleBtn.addEventListener('click', () => {
                yamlPanel.classList.toggle('collapsed');
                toggleBtn.innerHTML = yamlPanel.classList.contains('collapsed') ? '&#9650;' : '&#9660;';
            });
        }

        // Resize handle
        const resizeHandle = document.getElementById('yaml-resize-handle');
        if (resizeHandle && yamlPanel) {
            let resizing = false;
            let startY = 0;
            let startHeight = 0;

            resizeHandle.addEventListener('mousedown', (e) => {
                resizing = true;
                startY = e.clientY;
                startHeight = yamlPanel.offsetHeight;
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!resizing) return;
                const dy = startY - e.clientY;
                const newHeight = Math.max(100, Math.min(600, startHeight + dy));
                yamlPanel.style.height = newHeight + 'px';
            });

            document.addEventListener('mouseup', () => {
                resizing = false;
            });
        }
    }

    // ---- Modals ----
    function setupModals() {
        // Close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.closest('.modal')?.classList.add('hidden');
            });
        });

        // Click outside to close
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
        });

        // Import confirm
        document.getElementById('btn-import-confirm')?.addEventListener('click', () => {
            const textarea = document.getElementById('import-textarea');
            if (!textarea) return;
            const yaml = textarea.value.trim();
            if (!yaml) return;

            try {
                const newState = YAMLEngine.parseYAML(yaml);
                Designer.setState(newState);
                YAMLEngine.updateEditorFromState(Designer.getState());
                document.getElementById('import-modal')?.classList.add('hidden');
                textarea.value = '';
            } catch (e) {
                alert('Error parsing YAML: ' + e.message);
            }
        });
    }

    function showValidationModal(results) {
        const modal = document.getElementById('validation-modal');
        const resultsEl = document.getElementById('validation-results');
        if (!modal || !resultsEl) return;

        resultsEl.innerHTML = '';
        for (const result of results) {
            const item = document.createElement('div');
            item.className = `validation-item ${result.type}`;
            item.innerHTML = `
                <div class="val-type">${result.type}</div>
                <div>${escapeHtml(result.message)}</div>
                ${result.line ? `<div style="color:var(--text-muted);font-size:10px">Line ${result.line}</div>` : ''}
            `;
            resultsEl.appendChild(item);
        }

        modal.classList.remove('hidden');
    }

    // ---- Mode Toggle (Design / Preview) ----
    function setupModeToggle() {
        const designBtn = document.getElementById('btn-mode-design');
        const previewBtn = document.getElementById('btn-mode-preview');

        if (designBtn && previewBtn) {
            designBtn.addEventListener('click', () => {
                if (!PreviewMode.isActive()) return;
                designBtn.classList.add('active');
                previewBtn.classList.remove('active');
                PreviewMode.exit();
                // Re-enable design UI elements
                document.getElementById('panel-left').style.opacity = '';
                document.getElementById('panel-left').style.pointerEvents = '';
                document.getElementById('panel-right').style.opacity = '';
                document.getElementById('panel-right').style.pointerEvents = '';
            });

            previewBtn.addEventListener('click', () => {
                if (PreviewMode.isActive()) return;
                previewBtn.classList.add('active');
                designBtn.classList.remove('active');
                PreviewMode.enter();
                // Dim the side panels in preview mode
                document.getElementById('panel-left').style.opacity = '0.4';
                document.getElementById('panel-left').style.pointerEvents = 'none';
                document.getElementById('panel-right').style.opacity = '0.4';
                document.getElementById('panel-right').style.pointerEvents = 'none';
            });
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

})();
