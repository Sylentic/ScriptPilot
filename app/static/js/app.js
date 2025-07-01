// ScriptPilot Frontend JavaScript Application

class ScriptPilot {
    constructor() {
        this.apiBase = window.location.origin;
        this.currentTab = 'scripts';
        this.scripts = [];
        this.schedules = [];
        this.executions = [];
        this.autoRefreshInterval = null;
        this.autoRefreshEnabled = true;
        
        // Editor properties
        this.editor = null;
        this.currentScript = null;
        this.originalContent = '';
        
        this.init();
    }

    async init() {
        try {
            this.setupEventListeners();
            this.setupUploadArea();
            await this.loadInitialData();
            this.showTab('scripts');
            this.startAutoRefresh();
        } catch (error) {
            console.error('Error during initialization:', error);
            this.showToast('Error initializing application: ' + error.message, 'error');
        }
    }

    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.closest('.tab-btn').dataset.tab;
                this.showTab(tab);
            });
        });

        // Upload form
        document.getElementById('uploadForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.uploadScript();
        });

        // Create schedule form
        document.getElementById('createScheduleForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createSchedule();
        });

        // Search functionality
        document.getElementById('scriptSearch').addEventListener('input', (e) => {
            this.filterScripts(e.target.value);
        });

        // Execution filter
        document.getElementById('executionFilter').addEventListener('change', (e) => {
            this.filterExecutions(e.target.value);
        });

        // Close modals when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e.target.id);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+R for refresh
            if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                this.refreshCurrentTab();
            }
            
            // Ctrl+U for upload tab
            if (e.ctrlKey && e.key === 'u') {
                e.preventDefault();
                this.showTab('upload');
            }
            
            // Escape to close modals
            if (e.key === 'Escape') {
                const modals = document.querySelectorAll('.modal');
                modals.forEach(modal => {
                    if (modal.style.display === 'flex') {
                        modal.style.display = 'none';
                    }
                });
            }
            
            // Ctrl+S to save (when editor is open)
            if (e.ctrlKey && e.key === 's' && this.currentScript) {
                e.preventDefault();
                this.saveScript();
            }
            
            // Ctrl+N to create new script
            if (e.ctrlKey && e.key === 'n' && this.currentTab === 'scripts') {
                e.preventDefault();
                this.createNewScript();
            }
        });

        // New script form
        document.getElementById('newScriptForm').addEventListener('submit', (e) => {
            this.handleNewScriptForm(e);
        });
    }

    setupUploadArea() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');

        uploadArea.addEventListener('click', () => fileInput.click());
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                this.updateUploadAreaText(files[0].name);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.updateUploadAreaText(e.target.files[0].name);
            }
        });
    }

    updateUploadAreaText(filename) {
        const uploadArea = document.getElementById('uploadArea');
        uploadArea.innerHTML = `
            <i class="fas fa-file-check"></i>
            <h3>File Selected: ${filename}</h3>
            <p>Click to select a different file</p>
        `;
    }

    async loadInitialData() {
        this.showLoading();
        try {
            await Promise.all([
                this.loadStats(),
                this.loadScripts(),
                this.loadSchedules(),
                this.loadExecutions()
            ]);
        } catch (error) {
            this.showToast('Error loading data: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadStats() {
        try {
            const [execStats, schedStats] = await Promise.all([
                this.apiCall('/executions/stats/'),
                this.apiCall('/schedules/stats/').catch(() => ({ total_schedules: 0, active_schedules: 0 }))
            ]);

            this.renderStats(execStats, schedStats);
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    renderStats(execStats, schedStats) {
        const statsOverview = document.getElementById('statsOverview');
        
        if (!statsOverview) {
            console.error('Stats overview container not found');
            return;
        }
        
        statsOverview.innerHTML = `
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-play-circle"></i></div>
                <h3>${execStats.total_executions || 0}</h3>
                <p>Total Executions</p>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-chart-line"></i></div>
                <h3>${execStats.success_rate || 0}%</h3>
                <p>Success Rate</p>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-clock"></i></div>
                <h3>${schedStats.total_schedules || 0}</h3>
                <p>Total Schedules</p>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-play"></i></div>
                <h3>${schedStats.active_schedules || 0}</h3>
                <p>Active Schedules</p>
            </div>
        `;
        
        // Add a subtle animation to indicate fresh data
        statsOverview.style.opacity = '0.7';
        setTimeout(() => {
            statsOverview.style.opacity = '1';
        }, 200);
    }

    async loadScripts() {
        try {
            this.scripts = await this.apiCall('/scripts/db/');
            this.renderScripts();
            this.updateScheduleScriptOptions();
        } catch (error) {
            this.showToast('Error loading scripts: ' + error.message, 'error');
        }
    }

    renderScripts() {
        const container = document.getElementById('scriptsContainer');
        
        if (!container) {
            console.error('Scripts container not found');
            return;
        }
        
        if (this.scripts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-code"></i>
                    <h3>No scripts uploaded yet</h3>
                    <p>Upload your first script or create a new one to get started</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `
            <div class="scripts-table">
                <div class="scripts-table-header">
                    <div class="col-filename">Script</div>
                    <div class="col-language">Language</div>
                    <div class="col-description">Description</div>
                    <div class="col-created">Created</div>
                    <div class="col-lastrun">Last Run</div>
                    <div class="col-actions">Actions</div>
                </div>
                ${this.scripts.map(script => `
                    <div class="script-row" data-script-id="${script.id}">
                        <div class="col-filename">
                            <i class="fas fa-file-code script-icon"></i>
                            <span class="script-name">${this.getScriptNameWithoutExtension(script.filename)}</span>
                        </div>
                        <div class="col-language">
                            <span class="language-badge lang-${script.language.toLowerCase()}">${script.language}</span>
                        </div>
                        <div class="col-description">
                            <span class="script-description">${script.description || 'No description'}</span>
                        </div>
                        <div class="col-created">
                            <span class="script-date">${new Date(script.created_at).toLocaleDateString()}</span>
                            <span class="script-time">${new Date(script.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div class="col-lastrun">
                            <span class="last-run-info" data-script-id="${script.id}">Loading...</span>
                        </div>
                        <div class="col-actions">
                            <button class="btn-icon btn-primary" onclick="app.openScriptEditor(${script.id})" title="Edit Script">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-icon btn-success" onclick="app.executeScript(${script.id})" title="Execute">
                                <i class="fas fa-play"></i>
                            </button>
                            <button class="btn-icon btn-secondary" onclick="app.viewExecutionHistory(${script.id})" title="History">
                                <i class="fas fa-history"></i>
                            </button>
                            <button class="btn-icon btn-warning" onclick="app.scheduleScript(${script.id})" title="Schedule">
                                <i class="fas fa-clock"></i>
                            </button>
                            <button class="btn-icon btn-danger" onclick="app.deleteScript(${script.id})" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        // Load last run information for each script
        this.loadLastRunInfo();
    }

    filterScripts(searchTerm) {
        const filtered = this.scripts.filter(script => 
            script.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
            script.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            script.language.toLowerCase().includes(searchTerm.toLowerCase())
        );
        this.renderScripts(filtered);
    }

    async loadSchedules() {
        try {
            this.schedules = await this.apiCall('/schedules/');
            this.renderSchedules();
        } catch (error) {
            this.showToast('Error loading schedules: ' + error.message, 'error');
        }
    }

    renderSchedules() {
        const schedulesList = document.getElementById('schedulesList');
        
        if (!schedulesList) {
            console.error('Schedules list container not found');
            return;
        }
        
        if (this.schedules.length === 0) {
            schedulesList.innerHTML = `
                <div style="text-align: center; padding: 60px;">
                    <i class="fas fa-clock" style="font-size: 3rem; color: #cbd5e0; margin-bottom: 20px;"></i>
                    <h3 style="color: #718096; margin-bottom: 10px;">No schedules found</h3>
                    <p style="color: #a0aec0;">Create your first schedule to automate script execution!</p>
                </div>
            `;
            return;
        }

        schedulesList.innerHTML = this.schedules.map(schedule => `
            <div class="schedule-item">
                <div class="schedule-header">
                    <div class="schedule-info">
                        <h3>${schedule.name}</h3>
                        <span class="schedule-status status-${schedule.status}">${schedule.status}</span>
                    </div>
                    <div class="schedule-actions">
                        <button class="btn btn-success btn-small" onclick="app.runScheduleNow(${schedule.id})">
                            <i class="fas fa-play"></i> Run Now
                        </button>
                        <button class="btn btn-warning btn-small" onclick="app.toggleScheduleStatus(${schedule.id}, '${schedule.status}')">
                            <i class="fas fa-${schedule.status === 'active' ? 'pause' : 'play'}"></i> 
                            ${schedule.status === 'active' ? 'Pause' : 'Resume'}
                        </button>
                        <button class="btn btn-danger btn-small" onclick="app.deleteSchedule(${schedule.id})">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
                <div class="schedule-details">
                    <div class="detail-item">
                        <label>Script</label>
                        <span>${this.getScriptName(schedule.script_id)}</span>
                    </div>
                    <div class="detail-item">
                        <label>Type</label>
                        <span>${schedule.schedule_type}</span>
                    </div>
                    <div class="detail-item">
                        <label>Next Run</label>
                        <span>${schedule.next_run ? new Date(schedule.next_run).toLocaleString() : 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <label>Run Count</label>
                        <span>${schedule.run_count}${schedule.max_runs ? ` / ${schedule.max_runs}` : ''}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async loadExecutions() {
        try {
            this.executions = await this.apiCall('/executions/?limit=20');
            this.renderExecutions();
        } catch (error) {
            this.showToast('Error loading executions: ' + error.message, 'error');
        }
    }

    renderExecutions(executions = this.executions) {
        const executionsList = document.getElementById('executionsList');
        
        if (!executionsList) {
            console.error('Executions list container not found');
            return;
        }
        
        if (executions.length === 0) {
            executionsList.innerHTML = `
                <div style="text-align: center; padding: 60px;">
                    <i class="fas fa-play" style="font-size: 3rem; color: #cbd5e0; margin-bottom: 20px;"></i>
                    <h3 style="color: #718096; margin-bottom: 10px;">No executions found</h3>
                    <p style="color: #a0aec0;">Execute a script to see results here!</p>
                </div>
            `;
            return;
        }

        executionsList.innerHTML = executions.map(execution => `
            <div class="execution-item">
                <div class="execution-header">
                    <div class="execution-info">
                        <h3><i class="fas fa-file-code"></i> ${execution.filename}</h3>
                        <span class="execution-status status-${execution.success ? 'success' : 'failed'}">
                            <i class="fas fa-${execution.success ? 'check-circle' : 'times-circle'}"></i>
                            ${execution.success ? 'Success' : 'Failed'}
                        </span>
                    </div>
                    <div class="execution-actions">
                        <button class="btn btn-secondary btn-small" onclick="app.viewExecutionDetails(${execution.id})" title="View detailed output">
                            <i class="fas fa-info-circle"></i> Details
                        </button>
                        ${execution.success ? '' : '<span class="error-badge"><i class="fas fa-exclamation-triangle"></i> Error</span>'}
                    </div>
                </div>
                <div class="execution-details">
                    <div class="detail-row">
                        <div class="detail-item">
                            <label><i class="fas fa-clock"></i> Executed At</label>
                            <span>${new Date(execution.executed_at).toLocaleString()}</span>
                        </div>
                        <div class="detail-item">
                            <label><i class="fas fa-stopwatch"></i> Duration</label>
                            <span>${execution.execution_time_seconds}s</span>
                        </div>
                    </div>
                    <div class="detail-row">
                        <div class="detail-item">
                            <label><i class="fas fa-code"></i> Exit Code</label>
                            <span class="${execution.exit_code === 0 ? 'success-text' : 'error-text'}">${execution.exit_code}</span>
                        </div>
                        <div class="detail-item">
                            <label><i class="fas fa-user"></i> Triggered By</label>
                            <span class="trigger-badge trigger-${execution.triggered_by}">${execution.triggered_by}</span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    filterExecutions(successFilter) {
        let filtered = this.executions;
        if (successFilter !== '') {
            const success = successFilter === 'true';
            filtered = this.executions.filter(exec => exec.success === success);
        }
        this.renderExecutions(filtered);
    }

    showTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');

        this.currentTab = tabName;
    }

    async uploadScript() {
        const form = document.getElementById('uploadForm');
        const formData = new FormData(form);
        
        if (!formData.get('file') || formData.get('file').size === 0) {
            this.showToast('Please select a file to upload', 'error');
            return;
        }

        this.showLoading();
        try {
            await this.apiCall('/upload/', {
                method: 'POST',
                body: formData
            });
            
            this.showToast('Script uploaded successfully!', 'success');
            form.reset();
            document.getElementById('uploadArea').innerHTML = `
                <i class="fas fa-cloud-upload-alt"></i>
                <h3>Drop your script here or click to browse</h3>
                <p>Supported formats: .py, .ps1, .sh</p>
            `;
            
            await this.loadScripts();
            this.showTab('scripts');
        } catch (error) {
            this.showToast('Upload failed: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async executeScript(scriptId) {
        this.showLoading();
        try {
            const result = await this.apiCall(`/scripts/${scriptId}/execute/`, {
                method: 'POST'
            });
            
            this.showToast(`Script executed ${result.success ? 'successfully' : 'with errors'}!`, 
                         result.success ? 'success' : 'warning');
            
            await this.loadExecutions();
            await this.loadStats();
        } catch (error) {
            this.showToast('Execution failed: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    updateScheduleScriptOptions() {
        const select = document.getElementById('scheduleScript');
        select.innerHTML = '<option value="">Select a script...</option>' +
            this.scripts.map(script => 
                `<option value="${script.id}">${script.filename} (${script.language})</option>`
            ).join('');
    }

    showCreateScheduleModal() {
        // Set default start time to current time + 1 minute
        const now = new Date();
        now.setMinutes(now.getMinutes() + 1);
        const defaultTime = now.toISOString().slice(0, 16);
        document.getElementById('startTime').value = defaultTime;
        
        this.showModal('createScheduleModal');
    }

    createScheduleForScript(scriptId) {
        this.showCreateScheduleModal();
        document.getElementById('scheduleScript').value = scriptId;
    }

    async createSchedule() {
        const form = document.getElementById('createScheduleForm');
        const formData = new FormData(form);

        this.showLoading();
        try {
            await this.apiCall('/schedules/', {
                method: 'POST',
                body: formData
            });
            
            this.showToast('Schedule created successfully!', 'success');
            this.closeModal('createScheduleModal');
            form.reset();
            
            await this.loadSchedules();
            await this.loadStats();
            this.showTab('schedules');
        } catch (error) {
            this.showToast('Failed to create schedule: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async runScheduleNow(scheduleId) {
        this.showLoading();
        try {
            await this.apiCall(`/schedules/${scheduleId}/run-now/`, {
                method: 'POST'
            });
            
            this.showToast('Schedule executed successfully!', 'success');
            await this.loadExecutions();
            await this.loadSchedules();
            await this.loadStats();
        } catch (error) {
            this.showToast('Failed to run schedule: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async toggleScheduleStatus(scheduleId, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'paused' : 'active';
        
        this.showLoading();
        try {
            const formData = new FormData();
            formData.append('status', newStatus);
            
            await this.apiCall(`/schedules/${scheduleId}/status/`, {
                method: 'PUT',
                body: formData
            });
            
            this.showToast(`Schedule ${newStatus}!`, 'success');
            await this.loadSchedules();
            await this.loadStats();
        } catch (error) {
            this.showToast('Failed to update schedule: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async deleteSchedule(scheduleId) {
        if (!confirm('Are you sure you want to delete this schedule?')) {
            return;
        }

        this.showLoading();
        try {
            await this.apiCall(`/schedules/${scheduleId}`, {
                method: 'DELETE'
            });
            
            this.showToast('Schedule deleted successfully!', 'success');
            await this.loadSchedules();
            await this.loadStats();
        } catch (error) {
            this.showToast('Failed to delete schedule: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async viewExecutionDetails(executionId) {
        this.showLoading();
        try {
            const execution = await this.apiCall(`/executions/${executionId}`);
            
            document.getElementById('executionDetails').innerHTML = `
                <div class="execution-details">
                    <div class="detail-item">
                        <label>Script</label>
                        <span>${execution.filename}</span>
                    </div>
                    <div class="detail-item">
                        <label>Language</label>
                        <span>${execution.language}</span>
                    </div>
                    <div class="detail-item">
                        <label>Status</label>
                        <span class="execution-status status-${execution.success ? 'success' : 'failed'}">
                            ${execution.success ? 'Success' : 'Failed'}
                        </span>
                    </div>
                    <div class="detail-item">
                        <label>Exit Code</label>
                        <span>${execution.exit_code}</span>
                    </div>
                    <div class="detail-item">
                        <label>Duration</label>
                        <span>${execution.execution_time_seconds} seconds</span>
                    </div>
                    <div class="detail-item">
                        <label>Executed At</label>
                        <span>${new Date(execution.executed_at).toLocaleString()}</span>
                    </div>
                    <div class="detail-item">
                        <label>Triggered By</label>
                        <span>${execution.triggered_by}</span>
                    </div>
                </div>
                ${execution.stdout ? `
                    <div style="margin: 20px 0;">
                        <label style="display: block; margin-bottom: 10px; font-weight: 600;">Standard Output:</label>
                        <div class="code-block">${execution.stdout}</div>
                    </div>
                ` : ''}
                ${execution.stderr ? `
                    <div style="margin: 20px 0;">
                        <label style="display: block; margin-bottom: 10px; font-weight: 600;">Standard Error:</label>
                        <div class="code-block">${execution.stderr}</div>
                    </div>
                ` : ''}
                ${execution.error_message ? `
                    <div style="margin: 20px 0;">
                        <label style="display: block; margin-bottom: 10px; font-weight: 600;">Error Message:</label>
                        <div class="code-block">${execution.error_message}</div>
                    </div>
                ` : ''}
            `;
            
            this.showModal('executionModal');
        } catch (error) {
            this.showToast('Failed to load execution details: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    viewScriptExecutions(scriptId) {
        // Filter executions for this script and switch to executions tab
        const scriptExecutions = this.executions.filter(exec => exec.script_id === scriptId);
        this.renderExecutions(scriptExecutions);
        this.showTab('executions');
    }

    getScriptName(scriptId) {
        const script = this.scripts.find(s => s.id === scriptId);
        return script ? script.filename : 'Unknown Script';
    }

    getScriptNameWithoutExtension(filename) {
        const lastDotIndex = filename.lastIndexOf('.');
        return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
    }

    async loadLastRunInfo() {
        for (const script of this.scripts) {
            try {
                const executions = await this.apiCall(`/scripts/${script.id}/executions/?limit=1`);
                const lastRunElement = document.querySelector(`.last-run-info[data-script-id="${script.id}"]`);
                
                if (lastRunElement) {
                    if (executions.length > 0) {
                        const lastExecution = executions[0];
                        if (lastExecution.success) {
                            const lastRunDate = new Date(lastExecution.executed_at);
                            lastRunElement.innerHTML = `
                                <span class="last-run-date">${lastRunDate.toLocaleDateString()}</span>
                                <span class="last-run-time">${lastRunDate.toLocaleTimeString()}</span>
                            `;
                            lastRunElement.className = 'last-run-info success';
                        } else {
                            lastRunElement.innerHTML = `
                                <span class="last-run-failed">Last run failed</span>
                                <span class="last-run-time">${new Date(lastExecution.executed_at).toLocaleDateString()}</span>
                            `;
                            lastRunElement.className = 'last-run-info failed';
                        }
                    } else {
                        lastRunElement.innerHTML = '<span class="never-run">Never</span>';
                        lastRunElement.className = 'last-run-info never';
                    }
                }
            } catch (error) {
                const lastRunElement = document.querySelector(`.last-run-info[data-script-id="${script.id}"]`);
                if (lastRunElement) {
                    lastRunElement.innerHTML = '<span class="never-run">Never</span>';
                    lastRunElement.className = 'last-run-info never';
                }
            }
        }
    }

    // Refresh functions
    async refreshScripts() {
        await this.loadScripts();
        this.showToast('Scripts refreshed!', 'success');
    }

    async refreshSchedules() {
        await this.loadSchedules();
        this.showToast('Schedules refreshed!', 'success');
    }

    async refreshExecutions() {
        await this.loadExecutions();
        this.showToast('Executions refreshed!', 'success');
    }

    async refreshCurrentTab() {
        switch (this.currentTab) {
            case 'scripts':
                await this.refreshScripts();
                break;
            case 'schedules':
                await this.refreshSchedules();
                break;
            case 'executions':
                await this.refreshExecutions();
                break;
        }
    }

    startAutoRefresh() {
        // Refresh stats and current tab data every 30 seconds
        this.autoRefreshInterval = setInterval(async () => {
            if (this.autoRefreshEnabled && !document.getElementById('loadingOverlay').style.display) {
                try {
                    // Show subtle indicator
                    this.showRefreshIndicator();
                    
                    await this.loadStats();
                    
                    // Refresh current tab data
                    switch (this.currentTab) {
                        case 'scripts':
                            await this.loadScripts();
                            break;
                        case 'schedules':
                            await this.loadSchedules();
                            break;
                        case 'executions':
                            await this.loadExecutions();
                            break;
                    }
                } catch (error) {
                    console.log('Auto-refresh error:', error.message);
                }
            }
        }, 30000); // 30 seconds
    }

    showRefreshIndicator() {
        const statusIndicator = document.getElementById('autoRefreshStatus');
        const icon = statusIndicator.querySelector('i');
        
        // Flash the indicator
        icon.style.transform = 'scale(1.2)';
        icon.style.color = '#667eea';
        
        setTimeout(() => {
            icon.style.transform = 'scale(1)';
            icon.style.color = this.autoRefreshEnabled ? '#48bb78' : '#e53e3e';
        }, 500);
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }

    toggleAutoRefresh() {
        this.autoRefreshEnabled = !this.autoRefreshEnabled;
        
        // Update status indicator
        const statusIndicator = document.getElementById('autoRefreshStatus');
        const icon = statusIndicator.querySelector('i');
        
        if (this.autoRefreshEnabled) {
            icon.style.color = '#48bb78';
            statusIndicator.title = 'Auto-refresh enabled';
        } else {
            icon.style.color = '#e53e3e';
            statusIndicator.title = 'Auto-refresh disabled';
        }
        
        this.showToast(
            `Auto-refresh ${this.autoRefreshEnabled ? 'enabled' : 'disabled'}`, 
            'info'
        );
    }

    // Editor functions
    async initializeEditor() {
        // Wait for CodeMirror to be available
        if (!window.CodeMirror) {
            setTimeout(() => this.initializeEditor(), 100);
            return;
        }

        const { EditorView, basicSetup, python, javascript, shell, oneDark } = window.CodeMirror;
        
        // Create the editor
        this.editor = new EditorView({
            extensions: [
                basicSetup,
                oneDark,
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        this.updateEditorStatus();
                    }
                    if (update.selectionSet) {
                        this.updateCursorPosition();
                    }
                })
            ],
            parent: document.getElementById('codeEditor')
        });
    }

    updateEditorStatus() {
        const status = document.getElementById('editorStatus');
        const hasChanges = this.editor.state.doc.toString() !== this.originalContent;
        status.textContent = hasChanges ? 'Modified' : 'Ready';
        status.style.color = hasChanges ? '#ffc107' : '#28a745';
    }

    updateCursorPosition() {
        const pos = this.editor.state.selection.main.head;
        const line = this.editor.state.doc.lineAt(pos);
        const col = pos - line.from + 1;
        document.getElementById('cursorPosition').textContent = `Line ${line.number}, Column ${col}`;
    }

    setEditorLanguage(language) {
        if (!this.editor || !window.CodeMirror) return;
        
        const { python, javascript, shell } = window.CodeMirror;
        let langExtension;
        
        switch (language.toLowerCase()) {
            case 'python':
                langExtension = python();
                break;
            case 'javascript':
                langExtension = javascript();
                break;
            case 'powershell':
            case 'bash':
                langExtension = shell();
                break;
            default:
                return;
        }
        
        // Reconfigure the editor with the new language
        this.editor.dispatch({
            effects: this.editor.state.reconfigure([
                window.CodeMirror.basicSetup,
                window.CodeMirror.oneDark,
                langExtension,
                window.CodeMirror.EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        this.updateEditorStatus();
                    }
                    if (update.selectionSet) {
                        this.updateCursorPosition();
                    }
                })
            ])
        });
    }

    async openScriptEditor(scriptId) {
        try {
            // Fetch script content
            const response = await fetch(`${this.apiBase}/scripts/${scriptId}/content`);
            if (!response.ok) throw new Error('Failed to fetch script content');
            
            const script = await response.json();
            this.currentScript = script;
            this.originalContent = script.content || '';
            
            // Initialize editor if not already done
            if (!this.editor) {
                await this.initializeEditor();
            }
            
            // Set editor content
            this.editor.dispatch({
                changes: {
                    from: 0,
                    to: this.editor.state.doc.length,
                    insert: this.originalContent
                }
            });
            
            // Set language highlighting
            this.setEditorLanguage(script.language);
            
            // Update UI
            document.getElementById('editorTitle').textContent = `Edit Script - ${script.filename}`;
            document.getElementById('editorFilename').textContent = script.filename;
            document.getElementById('editorLanguage').textContent = script.language.toUpperCase();
            document.getElementById('editorLanguage').className = `language-badge lang-${script.language}`;
            
            this.updateEditorStatus();
            this.updateCursorPosition();
            
            // Show modal
            this.showModal('editorModal');
            
        } catch (error) {
            console.error('Error opening script editor:', error);
            this.showToast('Failed to open script editor', 'error');
        }
    }

    async createNewScript() {
        this.showModal('newScriptModal');
    }

    async handleNewScriptForm(event) {
        event.preventDefault();
        
        const name = document.getElementById('newScriptName').value;
        const language = document.getElementById('newScriptLanguage').value;
        const description = document.getElementById('newScriptDescription').value;
        
        // Validate file extension
        const expectedExt = language === 'python' ? '.py' : 
                           language === 'powershell' ? '.ps1' : 
                           language === 'bash' ? '.sh' : '';
        
        if (!name.endsWith(expectedExt)) {
            this.showToast(`Filename must end with ${expectedExt}`, 'error');
            return;
        }
        
        try {
            // Create a temporary script object
            this.currentScript = {
                filename: name,
                language: language,
                description: description,
                content: this.getLanguageTemplate(language)
            };
            
            this.originalContent = this.currentScript.content;
            
            // Close new script modal and open editor
            this.closeModal('newScriptModal');
            
            // Initialize editor if not already done
            if (!this.editor) {
                await this.initializeEditor();
            }
            
            // Set editor content
            this.editor.dispatch({
                changes: {
                    from: 0,
                    to: this.editor.state.doc.length,
                    insert: this.originalContent
                }
            });
            
            // Set language highlighting
            this.setEditorLanguage(language);
            
            // Update UI
            document.getElementById('editorTitle').textContent = `New Script - ${name}`;
            document.getElementById('editorFilename').textContent = name;
            document.getElementById('editorLanguage').textContent = language.toUpperCase();
            document.getElementById('editorLanguage').className = `language-badge lang-${language}`;
            
            this.updateEditorStatus();
            this.updateCursorPosition();
            
            // Show editor modal
            this.showModal('editorModal');
            
            // Reset form
            document.getElementById('newScriptForm').reset();
            
        } catch (error) {
            console.error('Error creating new script:', error);
            this.showToast('Failed to create new script', 'error');
        }
    }

    getLanguageTemplate(language) {
        switch (language) {
            case 'python':
                return `#!/usr/bin/env python3
"""
Script description goes here
"""

def main():
    print("Hello from ScriptPilot!")
    # Your code here

if __name__ == "__main__":
    main()
`;
            case 'powershell':
                return `# PowerShell Script
# Description: 

Write-Host "Hello from ScriptPilot!"
# Your code here
`;
            case 'bash':
                return `#!/bin/bash
# Bash Script
# Description: 

echo "Hello from ScriptPilot!"
# Your code here
`;
            default:
                return '';
        }
    }

    async saveScript() {
        if (!this.editor || !this.currentScript) return;
        
        try {
            const content = this.editor.state.doc.toString();
            const formData = new FormData();
            
            // Create a blob with the content
            const blob = new Blob([content], { type: 'text/plain' });
            formData.append('file', blob, this.currentScript.filename);
            formData.append('description', this.currentScript.description || '');
            
            const response = await fetch(`${this.apiBase}/upload/`, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) throw new Error('Failed to save script');
            
            const result = await response.json();
            this.originalContent = content;
            this.currentScript.id = result.id;
            
            this.updateEditorStatus();
            this.showToast('Script saved successfully!', 'success');
            
            // Refresh scripts list
            await this.loadScripts();
            
        } catch (error) {
            console.error('Error saving script:', error);
            this.showToast('Failed to save script', 'error');
        }
    }

    resetEditor() {
        if (!this.editor) return;
        
        this.editor.dispatch({
            changes: {
                from: 0,
                to: this.editor.state.doc.length,
                insert: this.originalContent
            }
        });
        
        this.updateEditorStatus();
        this.showToast('Changes reset', 'info');
    }

    async executeCurrentScript() {
        if (!this.currentScript || !this.currentScript.id) {
            this.showToast('Please save the script first', 'warning');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBase}/scripts/${this.currentScript.id}/execute/`, {
                method: 'POST'
            });
            
            if (!response.ok) throw new Error('Failed to execute script');
            
            const result = await response.json();
            this.showExecutionResult(result);
            
        } catch (error) {
            console.error('Error executing script:', error);
            this.showToast('Failed to execute script', 'error');
        }
    }

    // Utility functions
    async apiCall(endpoint, options = {}) {
        const response = await fetch(this.apiBase + endpoint, {
            headers: {
                'Accept': 'application/json',
                ...options.headers
            },
            ...options
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || `HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }
        return await response.text();
    }

    showModal(modalId) {
        document.getElementById(modalId).style.display = 'flex';
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'flex';
    }

    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }

    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'info' ? 'info-circle' : 'exclamation-triangle'}"></i>
                <span>${message}</span>
            </div>
        `;

        document.getElementById('toastContainer').appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 5000);
    }

    showHelpModal() {
        this.showModal('helpModal');
    }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ScriptPilot();
});
