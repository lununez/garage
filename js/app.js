/**
 * LVGL Visual Designer - Main Application
 * Orchestrates all modules: widget palette, designer canvas, YAML editor,
 * toolbar actions, HA integration, entity binding, device deployment,
 * and ensures bidirectional sync between visual and YAML.
 */

(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        initApp();
    });

    function initApp() {
        // Initialize HA Connection
        HAConnection.init();

        // Initialize Device Manager
        DeviceManager.init();

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

        // Initialize Font Manager
        FontManager.init([]);
        FontManager.onChange(() => {
            Designer.renderAll();
            YAMLEngine.updateEditorFromState(Designer.getState());
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
        setupHAConnection();
        setupEntityPicker();
        setupDeployment();

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

        // Update HA status dot
        updateHAStatusDot();
    }

    function autoLoadLastProject() {
        const lastName = localStorage.getItem('lvgl-designer-last-project');
        if (!lastName) return;
        const projects = getProjects();
        if (!projects[lastName]) return;
        const proj = projects[lastName];
        Designer.setState(proj.state);
        FontManager.init(proj.fonts || []);

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

                    const preview = document.createElement('div');
                    preview.className = 'drag-preview';
                    preview.textContent = widget.label;
                    document.body.appendChild(preview);
                    e.dataTransfer.setDragImage(preview, 0, 0);
                    setTimeout(() => preview.remove(), 0);
                });

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

        document.getElementById('btn-export-full')?.addEventListener('click', () => {
            YAMLEngine.exportFullYAML(Designer.getState());
        });

        document.getElementById('btn-import')?.addEventListener('click', () => {
            document.getElementById('import-modal')?.classList.remove('hidden');
        });

        document.getElementById('btn-save')?.addEventListener('click', () => saveProject());
        document.getElementById('btn-load')?.addEventListener('click', () => showLoadModal());
        document.getElementById('btn-fonts')?.addEventListener('click', () => FontManager.showModal());

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
            fonts: FontManager.getProjectFonts(),
            displaySize: sizeSelect ? sizeSelect.value : `${state.displayWidth}x${state.displayHeight}`,
            savedAt: new Date().toISOString(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
        localStorage.setItem('lvgl-designer-last-project', name);
        showToast('Project saved: ' + name);
    }

    function loadProject(name) {
        const projects = getProjects();
        const proj = projects[name];
        if (!proj) return;

        Designer.setState(proj.state);
        FontManager.init(proj.fonts || []);

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
        showLoadModal();
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
                    const opt = document.createElement('option');
                    opt.value = sizeStr;
                    opt.textContent = `${pw}x${ph} (Custom)`;
                    select.insertBefore(opt, select.querySelector('[value="custom"]'));
                    select.value = sizeStr;
                    Designer.setDisplaySize(pw, ph);
                    Designer.renderAll();
                } else {
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
        document.getElementById('btn-yaml-apply')?.addEventListener('click', () => {
            const result = YAMLEngine.applyEditorToDesigner();
            if (!result.success) {
                showValidationModal(result.results);
            }
        });

        document.getElementById('btn-yaml-format')?.addEventListener('click', () => {
            YAMLEngine.formatEditor();
        });

        const toggleBtn = document.getElementById('btn-yaml-toggle');
        const yamlPanel = document.getElementById('yaml-panel');
        if (toggleBtn && yamlPanel) {
            toggleBtn.addEventListener('click', () => {
                yamlPanel.classList.toggle('collapsed');
                toggleBtn.innerHTML = yamlPanel.classList.contains('collapsed') ? '&#9650;' : '&#9660;';
            });
        }

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
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.closest('.modal')?.classList.add('hidden');
            });
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
        });

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
                document.getElementById('panel-left').style.opacity = '0.4';
                document.getElementById('panel-left').style.pointerEvents = 'none';
                document.getElementById('panel-right').style.opacity = '0.4';
                document.getElementById('panel-right').style.pointerEvents = 'none';
            });
        }
    }

    // ---- Home Assistant Connection ----
    function setupHAConnection() {
        const connectBtn = document.getElementById('btn-ha-connect');
        connectBtn?.addEventListener('click', () => {
            const modal = document.getElementById('ha-modal');
            if (!modal) return;

            // Populate saved config
            const cfg = HAConnection.getConfig();
            document.getElementById('ha-url').value = cfg.url || '';
            document.getElementById('ha-token').value = cfg.token || '';

            updateHAModalStatus();
            modal.classList.remove('hidden');
        });

        document.getElementById('btn-ha-do-connect')?.addEventListener('click', async () => {
            const url = document.getElementById('ha-url').value.trim();
            const token = document.getElementById('ha-token').value.trim();

            if (!url || !token) {
                setHAStatus('Please enter both URL and token', 'error');
                return;
            }

            HAConnection.setConfig(url, token);
            setHAStatus('Connecting...', 'info');

            try {
                await HAConnection.connect();
                const entities = HAConnection.getEntities();
                const count = Object.keys(entities).length;
                setHAStatus(`Connected! Found ${count} entities`, 'success');
                updateHAModalStatus();
                updateHAStatusDot();
                showToast('Connected to Home Assistant');
            } catch (e) {
                setHAStatus('Connection failed: ' + e.message, 'error');
                updateHAStatusDot();
            }
        });

        document.getElementById('btn-ha-disconnect')?.addEventListener('click', () => {
            HAConnection.disconnect();
            setHAStatus('Disconnected', 'info');
            updateHAModalStatus();
            updateHAStatusDot();
        });

        // Listen for connection state changes
        HAConnection.onConnectionChange((connected) => {
            updateHAStatusDot();
            if (!connected) {
                updateHAModalStatus();
            }
        });
    }

    function setHAStatus(msg, type) {
        const el = document.getElementById('ha-connection-status');
        if (!el) return;
        el.textContent = msg;
        el.className = 'connection-status ' + type;
    }

    function updateHAModalStatus() {
        const connected = HAConnection.isConnected();
        const connectBtn = document.getElementById('btn-ha-do-connect');
        const disconnectBtn = document.getElementById('btn-ha-disconnect');
        if (connectBtn) connectBtn.style.display = connected ? 'none' : '';
        if (disconnectBtn) disconnectBtn.style.display = connected ? '' : 'none';
    }

    function updateHAStatusDot() {
        const dot = document.getElementById('ha-status-dot');
        if (!dot) return;
        const connected = HAConnection.isConnected();
        dot.className = 'ha-dot ' + (connected ? 'connected' : 'disconnected');
        dot.title = connected ? 'Connected to HA' : 'Not connected';
    }

    // ---- Entity Picker ----
    let selectedEntityId = null;
    let selectedEntityRole = null;
    let bindingTargetWidgetId = null;

    function setupEntityPicker() {
        // Entity search
        document.getElementById('entity-search')?.addEventListener('input', (e) => {
            filterEntityList(e.target.value);
        });

        document.getElementById('entity-domain-filter')?.addEventListener('change', () => {
            populateEntityList();
        });

        document.getElementById('btn-entity-bind')?.addEventListener('click', () => {
            if (!selectedEntityId || !selectedEntityRole || !bindingTargetWidgetId) return;

            const page = Designer.getCurrentPage();
            const widget = Designer.findWidgetById(bindingTargetWidgetId, page.widgets);
            if (!widget) return;

            const binding = EntityBinding.createBinding(selectedEntityId, selectedEntityRole, widget);
            if (binding) {
                widget.binding = binding;
                Designer.renderAll();
                YAMLEngine.updateEditorFromState(Designer.getState());
                showToast(`Bound ${widget.id} to ${selectedEntityId}`);
            }

            document.getElementById('entity-picker-modal')?.classList.add('hidden');
        });
    }

    /**
     * Open the entity picker for a specific widget.
     * Called from the properties panel "Bind Entity" button.
     */
    function openEntityPicker(widgetId) {
        if (!HAConnection.isConnected()) {
            showToast('Connect to Home Assistant first');
            document.getElementById('ha-modal')?.classList.remove('hidden');
            return;
        }

        bindingTargetWidgetId = widgetId;
        selectedEntityId = null;
        selectedEntityRole = null;

        // Populate domain filter
        const domainFilter = document.getElementById('entity-domain-filter');
        if (domainFilter) {
            const domains = HAConnection.getDomains();
            const supported = EntityBinding.getSupportedDomains();
            domainFilter.innerHTML = '<option value="">All Domains</option>';
            for (const domain of domains) {
                const opt = document.createElement('option');
                opt.value = domain;
                opt.textContent = domain + (supported.includes(domain) ? '' : ' (no templates)');
                domainFilter.appendChild(opt);
            }
        }

        populateEntityList();

        document.getElementById('entity-role-picker').style.display = 'none';
        document.getElementById('btn-entity-bind').disabled = true;
        document.getElementById('entity-picker-modal')?.classList.remove('hidden');
    }

    function populateEntityList() {
        const listEl = document.getElementById('entity-list');
        if (!listEl) return;

        const domainFilter = document.getElementById('entity-domain-filter')?.value || '';
        const searchQuery = document.getElementById('entity-search')?.value || '';

        let entities = domainFilter
            ? HAConnection.getEntitiesByDomain(domainFilter)
            : HAConnection.getEntities();

        // Sort by entity_id
        const sorted = Object.entries(entities).sort((a, b) => a[0].localeCompare(b[0]));

        listEl.innerHTML = '';
        for (const [entityId, entity] of sorted) {
            const name = entity.attributes?.friendly_name || entityId;
            const domain = entity.domain;
            const state = entity.state;

            // Apply search filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                if (!entityId.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) continue;
            }

            const itemEl = document.createElement('div');
            itemEl.className = 'entity-item';
            itemEl.dataset.entityId = entityId;
            itemEl.innerHTML = `
                <div class="entity-item-name">${escapeHtml(name)}</div>
                <div class="entity-item-id">${escapeHtml(entityId)}</div>
                <div class="entity-item-state">${escapeHtml(state)}</div>
            `;

            itemEl.addEventListener('click', () => {
                listEl.querySelectorAll('.entity-item').forEach(el => el.classList.remove('selected'));
                itemEl.classList.add('selected');
                selectedEntityId = entityId;
                showRolePicker(entityId);
            });

            listEl.appendChild(itemEl);
        }

        if (listEl.children.length === 0) {
            listEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);text-align:center">No matching entities</div>';
        }
    }

    function filterEntityList(query) {
        const listEl = document.getElementById('entity-list');
        if (!listEl) return;

        listEl.querySelectorAll('.entity-item').forEach(item => {
            const id = item.dataset.entityId || '';
            const name = item.querySelector('.entity-item-name')?.textContent || '';
            const q = query.toLowerCase();
            item.style.display = (id.toLowerCase().includes(q) || name.toLowerCase().includes(q)) ? '' : 'none';
        });
    }

    function showRolePicker(entityId) {
        const rolePicker = document.getElementById('entity-role-picker');
        const roleOptions = document.getElementById('entity-role-options');
        if (!rolePicker || !roleOptions) return;

        // Find the target widget type
        const page = Designer.getCurrentPage();
        const widget = Designer.findWidgetById(bindingTargetWidgetId, page.widgets);
        if (!widget) return;

        const roles = EntityBinding.getCompatibleRoles(entityId, widget.type);

        if (roles.length === 0) {
            roleOptions.innerHTML = '<div style="color:var(--text-muted)">No compatible binding for this entity + widget type</div>';
            rolePicker.style.display = 'block';
            document.getElementById('btn-entity-bind').disabled = true;
            return;
        }

        roleOptions.innerHTML = '';
        for (const { role, label } of roles) {
            const radioEl = document.createElement('label');
            radioEl.className = 'role-option';
            radioEl.innerHTML = `
                <input type="radio" name="entity-role" value="${role}">
                <span>${escapeHtml(label)}</span>
            `;
            radioEl.querySelector('input').addEventListener('change', () => {
                selectedEntityRole = role;
                document.getElementById('btn-entity-bind').disabled = false;
            });
            roleOptions.appendChild(radioEl);
        }

        // Auto-select if only one role
        if (roles.length === 1) {
            roleOptions.querySelector('input').checked = true;
            selectedEntityRole = roles[0].role;
            document.getElementById('btn-entity-bind').disabled = false;
        }

        rolePicker.style.display = 'block';
    }

    // Expose for use from designer properties panel
    window.AppActions.openEntityPicker = openEntityPicker;
    window.AppActions.removeBinding = function(widgetId) {
        const page = Designer.getCurrentPage();
        const widget = Designer.findWidgetById(widgetId, page.widgets);
        if (widget) {
            EntityBinding.removeBinding(widget);
            Designer.renderAll();
            YAMLEngine.updateEditorFromState(Designer.getState());
            showToast('Binding removed');
        }
    };

    // ---- Deployment ----
    let fetchedDeviceYaml = '';
    let mergedYaml = '';

    function setupDeployment() {
        document.getElementById('btn-deploy')?.addEventListener('click', () => {
            const modal = document.getElementById('deploy-modal');
            if (!modal) return;

            const cfg = DeviceManager.getConfig();
            document.getElementById('esphome-url').value = cfg.dashboardUrl || '';
            document.getElementById('esphome-device').value = cfg.deviceFile || '';

            document.getElementById('deploy-status').textContent = '';
            document.getElementById('deploy-diff').style.display = 'none';
            document.getElementById('deploy-log').style.display = 'none';
            document.getElementById('btn-deploy-preview').disabled = true;
            document.getElementById('btn-deploy-push').disabled = true;

            modal.classList.remove('hidden');
        });

        document.getElementById('btn-deploy-fetch')?.addEventListener('click', async () => {
            const url = document.getElementById('esphome-url').value.trim();
            const device = document.getElementById('esphome-device').value.trim();

            if (!url || !device) {
                setDeployStatus('Please enter dashboard URL and device file', 'error');
                return;
            }

            DeviceManager.setConfig(url, device);
            setDeployStatus('Fetching device YAML...', 'info');

            try {
                fetchedDeviceYaml = await DeviceManager.fetchDeviceYaml();
                setDeployStatus(`Fetched ${fetchedDeviceYaml.length} bytes`, 'success');
                document.getElementById('btn-deploy-preview').disabled = false;
            } catch (e) {
                setDeployStatus('Fetch failed: ' + e.message, 'error');
            }
        });

        document.getElementById('btn-deploy-preview')?.addEventListener('click', () => {
            if (!fetchedDeviceYaml) return;

            const designerYaml = YAMLEngine.generateFullYAML(Designer.getState());
            const sensorBlocks = EntityBinding.generateSensorBlocks(Designer.getState());

            mergedYaml = DeviceManager.mergeYaml(fetchedDeviceYaml, designerYaml, sensorBlocks);

            // Show diff
            const diff = DeviceManager.generateDiff(fetchedDeviceYaml, mergedYaml);
            const diffEl = document.getElementById('deploy-diff-content');
            if (diffEl) {
                diffEl.innerHTML = '';
                for (const line of diff) {
                    const span = document.createElement('div');
                    span.className = 'diff-line ' + line.type;
                    span.textContent = (line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  ') + line.text;
                    diffEl.appendChild(span);
                }
            }
            document.getElementById('deploy-diff').style.display = 'block';
            document.getElementById('btn-deploy-push').disabled = false;
            setDeployStatus('Preview ready. Review changes before pushing.', 'info');
        });

        document.getElementById('btn-deploy-push')?.addEventListener('click', async () => {
            if (!mergedYaml) return;

            if (!confirm('Push changes to device and compile? This will update the device YAML.')) return;

            setDeployStatus('Uploading YAML...', 'info');

            try {
                await DeviceManager.uploadDeviceYaml(mergedYaml);
                setDeployStatus('YAML uploaded. Starting compile...', 'success');

                // Show compile log
                document.getElementById('deploy-log').style.display = 'block';
                const logEl = document.getElementById('deploy-log-content');
                if (logEl) logEl.textContent = '';

                DeviceManager.triggerCompileUpload(
                    (line) => {
                        if (logEl) {
                            logEl.textContent += line + '\n';
                            logEl.scrollTop = logEl.scrollHeight;
                        }
                    },
                    (success) => {
                        if (success === true) {
                            setDeployStatus('Compile & upload successful!', 'success');
                        } else if (success === false) {
                            setDeployStatus('Compile failed. Check output above.', 'error');
                        } else {
                            setDeployStatus('Connection closed.', 'info');
                        }
                    }
                );
            } catch (e) {
                setDeployStatus('Upload failed: ' + e.message, 'error');
            }
        });
    }

    function setDeployStatus(msg, type) {
        const el = document.getElementById('deploy-status');
        if (!el) return;
        el.textContent = msg;
        el.className = 'connection-status ' + type;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

})();
