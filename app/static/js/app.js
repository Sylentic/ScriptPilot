// ScriptPilot Frontend JavaScript Application

class AuthManager {
    constructor() {
        this.token = localStorage.getItem('access_token');
        this.user = this.getStoredUser();
    }

    getStoredUser() {
        const userInfo = localStorage.getItem('user_info');
        return userInfo ? JSON.parse(userInfo) : null;
    }

    isAuthenticated() {
        return !!this.token;
    }

    getAuthHeaders() {
        return this.token ? { 'Authorization': `Bearer ${this.token}` } : {};
    }

    logout() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_info');
        window.location.href = '/login';
    }

    redirectToLogin() {
        window.location.href = '/login';
    }

    updateUser(userData) {
        this.user = userData;
        localStorage.setItem('user_info', JSON.stringify(userData));
    }
}

class ScriptPilot {
    constructor() {
        this.apiBase = window.location.origin;
        this.currentTab = 'scripts';
        this.scripts = [];
        this.schedules = [];
        this.executions = [];
        this.autoRefreshInterval = null;
        this.autoRefreshEnabled = true;
        
        // Initialize authentication
        this.auth = new AuthManager();
        
        // Editor properties
        this.editor = null;
        this.editorType = null; // 'codemirror' or 'textarea'
        this.currentScript = null;
        this.originalContent = '';
        
        // Performance optimizations
        this.lastRunCache = new Map(); // Cache for script last run data
        this.cacheExpiry = 60000; // Cache expires after 1 minute
        
        this.init();
    }

    async init() {
        try {
            // Check authentication first
            if (!this.auth.isAuthenticated()) {
                this.auth.redirectToLogin();
                return;
            }

            // Verify token and ensure user data is properly loaded
            const isValid = await this.verifyToken();
            if (!isValid) {
                this.auth.redirectToLogin();
                return;
            }

            // Ensure user data is available before proceeding
            if (!this.auth.user) {
                console.error('User data not available after token verification');
                this.auth.redirectToLogin();
                return;
            }

            this.setupEventListeners();
            this.setupUploadArea();
            this.updateUserInfo();
            
            // Initialize admin panel first to ensure proper permissions are set
            await this.initAdminPanel();
            
            // Now load data with proper user context
            await this.loadInitialData();
            this.showTab('scripts');
            this.startAutoRefresh();
            
            // Pre-initialize editor for faster first-time opening
            this.preInitializeEditor();
        } catch (error) {
            console.error('Error during initialization:', error);
            this.showToast('Error initializing application: ' + error.message, 'error');
        }
    }

    async verifyToken() {
        try {
            const response = await fetch(`${this.apiBase}/auth/me`, {
                headers: this.auth.getAuthHeaders()
            });
            
            if (response.ok) {
                const userData = await response.json();
                this.auth.updateUser(userData);
                console.log('User data updated:', userData.role); // Debug log
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Token verification failed:', error);
            return false;
        }
    }

    updateUserInfo() {
        if (this.auth.user) {
            // Update header with user info
            const headerContent = document.querySelector('.header-content');
            if (headerContent) {
                const userInfoDiv = document.createElement('div');
                userInfoDiv.className = 'user-info';
                userInfoDiv.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 15px; margin-top: 10px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-user-circle" style="color: #007acc; font-size: 1.2rem;"></i>
                            <span style="color: #d4d4d4; font-weight: 500;">
                                ${this.auth.user.full_name || this.auth.user.username}
                            </span>
                            <span class="user-role" style="
                                background: rgba(0, 122, 204, 0.2);
                                border: 1px solid #007acc;
                                color: #007acc;
                                padding: 2px 8px;
                                border-radius: 4px;
                                font-size: 0.8rem;
                                text-transform: uppercase;
                                font-weight: 600;
                            ">${this.auth.user.role}</span>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button class="btn btn-secondary btn-small" onclick="app.showUserSettings()" title="User Settings">
                                <i class="fas fa-cog"></i>
                            </button>
                            <button class="btn btn-secondary btn-small" onclick="app.logout()" title="Logout">
                                <i class="fas fa-sign-out-alt"></i>
                            </button>
                        </div>
                    </div>
                `;
                
                // Insert user info after the main header content
                const existingUserInfo = headerContent.querySelector('.user-info');
                if (existingUserInfo) {
                    existingUserInfo.replaceWith(userInfoDiv);
                } else {
                    headerContent.appendChild(userInfoDiv);
                }
            }
        }
    }

    logout() {
        if (confirm('Are you sure you want to logout?')) {
            this.auth.logout();
        }
    }

    // Pre-initialize editor in background for faster opening
    async preInitializeEditor() {
        setTimeout(async () => {
            if (!this.editor) {
                console.log('Pre-initializing editor for faster first-time opening...');
                try {
                    await this.initializeEditor();
                    console.log('Editor pre-initialized successfully');
                } catch (error) {
                    console.log('Editor pre-initialization failed, will initialize on demand');
                }
            }
        }, 1000); // Wait 1 second after app loads
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
            // Load critical data first (scripts and stats) for faster perceived performance
            const [scriptsLoaded, statsLoaded] = await Promise.allSettled([
                this.loadScripts(),
                this.loadStats()
            ]);
            
            // Handle errors gracefully
            if (scriptsLoaded.status === 'rejected') {
                console.error('Failed to load scripts:', scriptsLoaded.reason);
                this.showToast('Failed to load scripts', 'error');
            }
            
            if (statsLoaded.status === 'rejected') {
                console.error('Failed to load stats:', statsLoaded.reason);
            }
            
            // Load secondary data in background without blocking UI
            this.loadSecondaryData();
            
        } catch (error) {
            this.showToast('Error loading data: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    // Load secondary data that's not immediately visible
    async loadSecondaryData() {
        try {
            await Promise.allSettled([
                this.loadSchedules(),
                this.loadExecutions()
            ]);
        } catch (error) {
            console.log('Error loading secondary data:', error);
            // Don't show toast for secondary data errors as UI is already loaded
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
            console.log('Loading scripts...', 'User role:', this.auth.user?.role); // Debug log
            this.scripts = await this.apiCall('/scripts/db/');
            console.log('Scripts loaded:', this.scripts.length); // Debug log
            
            // Render scripts immediately for faster UI
            this.renderScripts();
            this.updateScheduleScriptOptions();
            
            // Load last run info in background without blocking
            this.loadLastRunInfoAsync();
        } catch (error) {
            console.error('Error loading scripts:', error);
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
                            <span class="last-run-info" data-script-id="${script.id}">
                                <span class="loading-dot">•</span>
                            </span>
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
    }

    filterScripts(searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') {
            // If no search term, show all scripts
            this.renderScripts();
            this.loadLastRunInfoAsync(); // Reload last run info for all scripts
            return;
        }
        
        const filtered = this.scripts.filter(script => 
            script.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
            script.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            script.language.toLowerCase().includes(searchTerm.toLowerCase())
        );
        
        // Temporarily store original scripts and replace with filtered
        const originalScripts = this.scripts;
        this.scripts = filtered;
        this.renderScripts();
        this.loadLastRunInfoAsync(); // Load last run info for filtered scripts
        this.scripts = originalScripts; // Restore original scripts
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
        
        // Load admin data when switching to admin tab
        if (tabName === 'admin') {
            this.loadAdminData();
        }
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
                <p>Supported formats: .py, .ps1, .sh, .js, .bat, .cmd, .rb, .php, .pl, .r</p>
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
            
            // Clear cache for this script since it just executed
            this.clearLastRunCache(scriptId);
            
            await this.loadExecutions();
            await this.loadStats();
            
            // Update the last run info for this specific script
            setTimeout(() => {
                this.updateSingleScriptLastRun(scriptId);
            }, 500); // Small delay to ensure backend is updated
            
        } catch (error) {
            this.showToast('Execution failed: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    // Update last run info for a single script
    async updateSingleScriptLastRun(scriptId) {
        try {
            const lastRun = await this.getScriptLastRun(scriptId);
            this.updateLastRunDisplay(scriptId, lastRun);
        } catch (error) {
            console.warn(`Failed to update last run for script ${scriptId}:`, error);
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
        console.log('=== CREATE SCHEDULE DEBUG START ===');
        
        const form = document.getElementById('createScheduleForm');
        console.log('Form element found:', !!form);
        
        if (!form) {
            this.showToast('Schedule form not found! Please refresh the page.', 'error');
            return;
        }

        // Try multiple methods to get form data
        console.log('Trying FormData approach...');
        const formData = new FormData(form);
        const formDataEntries = {};
        for (let [key, value] of formData.entries()) {
            formDataEntries[key] = value;
        }
        console.log('FormData entries:', formDataEntries);

        // Also try direct element access
        console.log('Trying direct element access...');
        const scriptIdElement = document.getElementById('scheduleScript');
        const nameElement = document.getElementById('scheduleName');
        const scheduleTypeElement = document.getElementById('scheduleType');
        const startTimeElement = document.getElementById('startTime');
        const maxRunsElement = document.getElementById('maxRuns');
        
        console.log('Elements found:', {
            scheduleScript: !!scriptIdElement,
            scheduleName: !!nameElement,
            scheduleType: !!scheduleTypeElement,
            startTime: !!startTimeElement,
            maxRuns: !!maxRunsElement
        });

        console.log('Raw form values:', {
            scriptId: scriptIdElement ? scriptIdElement.value : 'ELEMENT NOT FOUND',
            name: nameElement ? nameElement.value : 'ELEMENT NOT FOUND',
            scheduleType: scheduleTypeElement ? scheduleTypeElement.value : 'ELEMENT NOT FOUND',
            startTime: startTimeElement ? startTimeElement.value : 'ELEMENT NOT FOUND',
            maxRuns: maxRunsElement ? maxRunsElement.value : 'ELEMENT NOT FOUND'
        });

        // Use FormData if elements not found directly, otherwise use direct access
        let scriptId, name, scheduleType, startTime, maxRuns;

        if (scriptIdElement && nameElement && scheduleTypeElement && startTimeElement) {
            console.log('Using direct element access');
            scriptId = scriptIdElement.value;
            name = nameElement.value.trim();
            scheduleType = scheduleTypeElement.value;
            startTime = startTimeElement.value;
            maxRuns = maxRunsElement ? maxRunsElement.value.trim() : '';
        } else {
            console.log('Using FormData fallback');
            scriptId = formDataEntries.script_id || '';
            name = (formDataEntries.name || '').trim();
            scheduleType = formDataEntries.schedule_type || '';
            startTime = formDataEntries.start_time || '';
            maxRuns = (formDataEntries.max_runs || '').trim();
        }

        console.log('Extracted values:', { scriptId, name, scheduleType, startTime, maxRuns });

        // Build schedule data object
        const scheduleData = {
            script_id: parseInt(scriptId, 10),
            name: name,
            schedule_type: scheduleType,
            start_time: startTime ? new Date(startTime).toISOString() : ''
        };

        // Handle optional max_runs field
        if (maxRuns && maxRuns !== '') {
            scheduleData.max_runs = parseInt(maxRuns, 10);
        }

        console.log('Schedule data before validation:', scheduleData);

        // Validate required fields
        if (!scriptId || scriptId === '' || isNaN(scheduleData.script_id)) {
            this.showToast('Please select a script', 'error');
            console.log('Validation failed: script_id');
            return;
        }
        if (!name) {
            this.showToast('Please enter a schedule name', 'error');
            console.log('Validation failed: name');
            return;
        }
        if (!scheduleType) {
            this.showToast('Please select a schedule type', 'error');
            console.log('Validation failed: schedule_type');
            return;
        }
        if (!startTime) {
            this.showToast('Please select a start time', 'error');
            console.log('Validation failed: start_time');
            return;
        }

        console.log('Final schedule data being sent:', scheduleData);
        console.log('=== CREATE SCHEDULE DEBUG END ===');

        this.showLoading();
        try {
            console.log('Making API call to /schedules/...');
            
            // Backend expects Form data, not JSON
            const formDataForAPI = new FormData();
            formDataForAPI.append('script_id', scheduleData.script_id.toString());
            formDataForAPI.append('name', scheduleData.name);
            formDataForAPI.append('schedule_type', scheduleData.schedule_type);
            formDataForAPI.append('start_time', scheduleData.start_time);
            
            if (scheduleData.max_runs) {
                formDataForAPI.append('max_runs', scheduleData.max_runs.toString());
            }
            
            console.log('Form data being sent:');
            for (let [key, value] of formDataForAPI.entries()) {
                console.log(`  ${key}: ${value}`);
            }
            
            const response = await fetch(`${this.apiBase}/schedules/`, {
                method: 'POST',
                body: formDataForAPI  // Send as form data, not JSON
            });
            
            console.log('Response status:', response.status);
            console.log('Response headers:', Object.fromEntries(response.headers.entries()));
            
            if (!response.ok) {
                const errorText = await response.text();
                console.log('Error response body:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Success response:', result);
            
            this.showToast('Schedule created successfully!', 'success');
            this.closeModal('createScheduleModal');
            form.reset();
            
            await this.loadSchedules();
            await this.loadStats();
            this.showTab('schedules');
        } catch (error) {
            console.error('API call failed:', error);
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

    // Load last run info asynchronously without blocking UI
    async loadLastRunInfoAsync() {
        if (this.scripts.length === 0) return;
        
        try {
            console.log(`Loading last run info for ${this.scripts.length} scripts in parallel...`);
            
            // For better performance with many scripts, process in batches
            const batchSize = 10; // Process 10 scripts at a time
            const batches = [];
            
            for (let i = 0; i < this.scripts.length; i += batchSize) {
                batches.push(this.scripts.slice(i, i + batchSize));
            }
            
            // Process batches sequentially to avoid overwhelming the server
            for (const batch of batches) {
                const batchPromises = batch.map(script => 
                    this.getScriptLastRun(script.id).catch(error => {
                        console.warn(`Failed to load last run for script ${script.id}:`, error);
                        return null; // Return null on error, handle gracefully
                    })
                );
                
                const batchResults = await Promise.all(batchPromises);
                
                // Update UI immediately for this batch
                batchResults.forEach((lastRun, index) => {
                    const script = batch[index];
                    this.updateLastRunDisplay(script.id, lastRun);
                });
                
                // Small delay between batches to prevent overwhelming the server
                if (batches.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            console.log('Last run info loaded successfully');
        } catch (error) {
            console.error('Error loading last run info:', error);
            // Fallback: show "Never" for all scripts
            this.scripts.forEach(script => {
                this.updateLastRunDisplay(script.id, null);
            });
        }
    }

    // Get last run for a single script with caching
    async getScriptLastRun(scriptId) {
        const cacheKey = `lastrun_${scriptId}`;
        const cached = this.lastRunCache.get(cacheKey);
        
        // Check if cache is valid (not expired)
        if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
            return cached.data;
        }
        
        try {
            const executions = await this.apiCall(`/scripts/${scriptId}/executions/?limit=1`);
            const result = executions.length > 0 ? executions[0] : null;
            
            // Cache the result
            this.lastRunCache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });
            
            return result;
        } catch (error) {
            // If cached data exists (even if expired), use it as fallback
            if (cached) {
                console.warn(`API failed for script ${scriptId}, using cached data`);
                return cached.data;
            }
            throw error;
        }
    }

    // Clear cache when scripts are executed or updated
    clearLastRunCache(scriptId = null) {
        if (scriptId) {
            this.lastRunCache.delete(`lastrun_${scriptId}`);
        } else {
            this.lastRunCache.clear();
        }
    }

    // Update last run display for a specific script
    updateLastRunDisplay(scriptId, lastExecution) {
        const lastRunElement = document.querySelector(`.last-run-info[data-script-id="${scriptId}"]`);
        
        if (!lastRunElement) return;
        
        if (lastExecution) {
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

    // Legacy function - keeping for backward compatibility but optimized
    async loadLastRunInfo() {
        console.warn('loadLastRunInfo is deprecated, use loadLastRunInfoAsync instead');
        await this.loadLastRunInfoAsync();
    }

    // Refresh functions
    async refreshScripts() {
        // Clear cache to ensure fresh data
        this.clearLastRunCache();
        await this.loadScripts();
        this.showToast('Scripts refreshed!', 'success');
    }

    async refreshSchedules() {
        await this.loadSchedules();
        this.showToast('Schedules refreshed!', 'success');
    }

    async refreshExecutions() {
        // Clear cache when refreshing executions as last run data might have changed
        this.clearLastRunCache();
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
        return new Promise((resolve) => {
            // Wait for CodeMirror to be available
            window.waitForCodeMirror((available) => {
                if (!available) {
                    console.log('CodeMirror not available, using fallback editor');
                    this.initializeFallbackEditor();
                    resolve();
                    return;
                }

                try {
                    console.log('Initializing CodeMirror editor...');
                    
                    const container = document.getElementById('codeEditor');
                    if (!container) {
                        throw new Error('Code editor container not found');
                    }
                    
                    // Clear any existing content including loading indicator
                    container.innerHTML = '';
                    
                    // Create the editor using CodeMirror 5
                    this.editor = window.createCodeMirrorEditor(container, '', 'python');
                    
                    if (this.editor) {
                        console.log('CodeMirror editor initialized successfully');
                        this.editorType = 'codemirror';
                    } else {
                        throw new Error('Failed to create CodeMirror editor');
                    }
                    
                    resolve();
                } catch (error) {
                    console.error('Error initializing CodeMirror editor:', error);
                    this.initializeFallbackEditor();
                    resolve();
                }
            });
        });
    }

    initializeFallbackEditor() {
        try {
            console.log('Initializing fallback textarea editor...');
            const container = document.getElementById('codeEditor');
            if (!container) {
                throw new Error('Code editor container not found');
            }
            
            this.editor = window.createFallbackEditor(container);
            this.editorType = 'textarea';
            console.log('Fallback editor initialized successfully');
        } catch (error) {
            console.error('Error initializing fallback editor:', error);
            this.showToast('Failed to initialize code editor', 'error');
        }
    }

    updateEditorStatus() {
        if (!this.editor) return;
        
        const status = document.getElementById('editorStatus');
        if (!status) return;
        
        try {
            let currentContent = '';
            if (this.editorType === 'codemirror') {
                currentContent = this.editor.state.doc.toString();
            } else {
                currentContent = this.editor.getValue();
            }
            
            const hasChanges = currentContent !== this.originalContent;
            status.textContent = hasChanges ? 'Modified' : 'Ready';
            status.style.color = hasChanges ? '#ffc107' : '#28a745';
        } catch (error) {
            console.error('Error updating editor status:', error);
        }
    }

    updateCursorPosition() {
        if (!this.editor) return;
        
        const positionEl = document.getElementById('cursorPosition');
        if (!positionEl) return;
        
        try {
            if (this.editorType === 'codemirror') {
                // For CodeMirror 5
                const cursor = this.editor.getCursor();
                positionEl.textContent = `Line ${cursor.line + 1}, Column ${cursor.ch + 1}`;
            } else {
                // For textarea fallback
                const textarea = this.editor.getElement();
                const pos = textarea.selectionStart;
                const beforeCursor = textarea.value.substring(0, pos);
                const lines = beforeCursor.split('\n');
                const line = lines.length;
                const col = lines[lines.length - 1].length + 1;
                positionEl.textContent = `Line ${line}, Column ${col}`;
            }
        } catch (error) {
            console.error('Error updating cursor position:', error);
        }
    }

    setEditorLanguage(language) {
        if (!this.editor || !window.CodeMirror || this.editorType !== 'codemirror') return;
        
        try {
            // Map language to CodeMirror MIME type with extended support
            const modeMap = {
                'python': 'text/x-python',
                'powershell': 'text/x-sh', // Fallback to shell mode for PowerShell
                'bash': 'text/x-sh',
                'sh': 'text/x-sh',
                'javascript': 'text/javascript',
                'js': 'text/javascript',
                'batch': 'text/x-sh', // Use shell mode for batch files
                'ruby': 'text/x-ruby',
                'php': 'text/x-php',
                'perl': 'text/x-perl',
                'r': 'text/x-rsrc'
            };
            
            const mode = modeMap[language.toLowerCase()] || 'text/plain';
            
            // Set the mode for CodeMirror 5
            this.editor.setOption('mode', mode);
            
            console.log(`Editor language set to: ${language} (mode: ${mode})`);
        } catch (error) {
            console.error('Error setting editor language:', error);
        }
    }

    async openScriptEditor(scriptId) {
        console.log('Opening script editor for script ID:', scriptId);
        
        // Show modal immediately for better UX
        this.showModal('editorModal');
        this.showEditorLoading(true);
        document.getElementById('editorTitle').textContent = 'Loading Script...';
        document.getElementById('editorFilename').textContent = 'Loading...';
        document.getElementById('editorLanguage').textContent = '';
        document.getElementById('editorLanguage').className = 'language-badge';
        
        try {
            // Initialize editor and fetch content in parallel
            const [editorReady, script] = await Promise.all([
                this.ensureEditorReady(),
                this.fetchScriptContent(scriptId)
            ]);
            
            console.log('Script data received:', script);
            this.currentScript = script;
            this.originalContent = script.content || '';
            
            // Hide loading and set editor content efficiently
            this.showEditorLoading(false);
            this.setEditorContentAndLanguage(script);
            
            // Update UI
            document.getElementById('editorTitle').textContent = `Edit Script - ${script.filename}`;
            document.getElementById('editorFilename').textContent = script.filename;
            document.getElementById('editorLanguage').textContent = script.language.toUpperCase();
            document.getElementById('editorLanguage').className = `language-badge lang-${script.language}`;
            
            this.updateEditorStatus();
            this.updateCursorPosition();
            
        } catch (error) {
            console.error('Error opening script editor:', error);
            this.showToast('Failed to open script editor', 'error');
            this.closeModal('editorModal');
        }
    }

    // Show/hide editor loading indicator
    showEditorLoading(show) {
        const loadingEl = document.getElementById('editorLoading');
        if (loadingEl) {
            loadingEl.style.display = show ? 'flex' : 'none';
        }
    }

    // Ensure editor is ready (initialize if needed)
    async ensureEditorReady() {
        if (!this.editor) {
            console.log('Editor not initialized, initializing...');
            await this.initializeEditor();
        }
        
        if (!this.editor) {
            throw new Error('Failed to initialize editor');
        }
        
        return true;
    }

    // Fetch script content separately for parallel execution
    async fetchScriptContent(scriptId) {
        console.log('Fetching script content...');
        return await this.apiCall(`/scripts/${scriptId}/content`);
    }

    // Set editor content and language more efficiently
    setEditorContentAndLanguage(script) {
        console.log('Setting editor content...');
        if (this.editorType === 'codemirror') {
            // Map language to CodeMirror MIME type with extended support
            const modeMap = {
                'python': 'text/x-python',
                'powershell': 'text/x-sh', // Fallback to shell mode for PowerShell
                'bash': 'text/x-sh',
                'sh': 'text/x-sh',
                'javascript': 'text/javascript',
                'js': 'text/javascript',
                'batch': 'text/x-sh', // Use shell mode for batch files
                'ruby': 'text/x-ruby',
                'php': 'text/x-php',
                'perl': 'text/x-perl',
                'r': 'text/x-rsrc'
            };
            
            const mode = modeMap[script.language.toLowerCase()] || 'text/plain';
            
            // Set content and mode for CodeMirror 5
            this.editor.setValue(this.originalContent);
            this.editor.setOption('mode', mode);
            
            console.log(`Editor content and language set: ${script.language} (mode: ${mode})`);
        } else {
            this.editor.setValue(this.originalContent);
        }
    }

    async createNewScript() {
        this.showModal('newScriptModal');
    }

    async handleNewScriptForm(event) {
        event.preventDefault();
        
        const name = document.getElementById('newScriptName').value.trim();
        const language = document.getElementById('newScriptLanguage').value;
        const description = document.getElementById('newScriptDescription').value;
        
        // Map language to file extension
        const extensionMap = {
            'python': '.py',
            'powershell': '.ps1', 
            'bash': '.sh',
            'javascript': '.js',
            'batch': '.bat',
            'ruby': '.rb',
            'php': '.php',
            'perl': '.pl',
            'r': '.r'
        };
        
        const expectedExt = extensionMap[language];
        
        if (!expectedExt) {
            this.showToast('Unsupported language selected', 'error');
            return;
        }
        
        // Auto-append file extension if not present
        let finalName = name;
        if (!name.endsWith(expectedExt)) {
            // Remove any existing extension first
            const lastDotIndex = name.lastIndexOf('.');
            if (lastDotIndex > 0) {
                finalName = name.substring(0, lastDotIndex);
            }
            finalName += expectedExt;
        }
        
        try {
            // Close new script modal and show editor modal immediately
            this.closeModal('newScriptModal');
            this.showModal('editorModal');
            this.showEditorLoading(true);
            
            // Update UI immediately
            document.getElementById('editorTitle').textContent = `New Script - ${finalName}`;
            document.getElementById('editorFilename').textContent = finalName;
            document.getElementById('editorLanguage').textContent = language.toUpperCase();
            document.getElementById('editorLanguage').className = `language-badge lang-${language}`;
            
            // Create a temporary script object
            this.currentScript = {
                filename: finalName,
                language: language,
                description: description,
                content: this.getLanguageTemplate(language)
            };
            
            this.originalContent = this.currentScript.content;
            
            // Ensure editor is ready and set content
            await this.ensureEditorReady();
            this.showEditorLoading(false);
            this.setEditorContentAndLanguage(this.currentScript);
            
            this.updateEditorStatus();
            this.updateCursorPosition();
            
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
            case 'javascript':
                return `// JavaScript Script
// Description: 

console.log("Hello from ScriptPilot!");
// Your code here
`;
            case 'batch':
                return `@echo off
REM Batch Script
REM Description: 

echo Hello from ScriptPilot!
REM Your code here
`;
            case 'ruby':
                return `#!/usr/bin/env ruby
# Ruby Script
# Description: 

puts "Hello from ScriptPilot!"
# Your code here
`;
            case 'php':
                return `<?php
// PHP Script
// Description: 

echo "Hello from ScriptPilot!\\n";
// Your code here
?>
`;
            case 'perl':
                return `#!/usr/bin/env perl
# Perl Script
# Description: 

use strict;
use warnings;

print "Hello from ScriptPilot!\\n";
# Your code here
`;
            case 'r':
                return `# R Script
# Description: 

cat("Hello from ScriptPilot!\\n")
# Your code here
`;
            default:
                return '';
        }
    }

    async saveScript() {
        if (!this.editor || !this.currentScript) {
            this.showToast('No script to save', 'warning');
            return;
        }
        
        try {
            let content = '';
            if (this.editorType === 'codemirror') {
                content = this.editor.state.doc.toString();
            } else {
                content = this.editor.getValue();
            }
            
            if (this.currentScript.id) {
                // Update existing script
                const response = await fetch(`${this.apiBase}/scripts/${this.currentScript.id}/content`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        content: content,
                        description: this.currentScript.description || ''
                    })
                });
                
                if (!response.ok) throw new Error('Failed to update script');
                
                this.originalContent = content;
                this.updateEditorStatus();
                this.showToast('Script updated successfully!', 'success');
                
            } else {
                // Create new script
                const formData = new FormData();
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
                
                // Update current script with the new ID and info
                const scriptsResponse = await fetch(`${this.apiBase}/scripts/db/`);
                const scripts = await scriptsResponse.json();
                this.currentScript = scripts.find(s => s.filename === this.currentScript.filename) || this.currentScript;
                
                this.updateEditorStatus();
                this.showToast('Script created successfully!', 'success');
            }
            
            // Refresh scripts list
            await this.loadScripts();
            
        } catch (error) {
            console.error('Error saving script:', error);
            this.showToast('Failed to save script: ' + error.message, 'error');
        }
    }

    resetEditor() {
        if (!this.editor) {
            this.showToast('No editor to reset', 'warning');
            return;
        }
        
        try {
            if (this.editorType === 'codemirror') {
                this.editor.dispatch({
                    changes: {
                        from: 0,
                        to: this.editor.state.doc.length,
                        insert: this.originalContent
                    }
                });
            } else {
                this.editor.setValue(this.originalContent);
            }
            
            this.updateEditorStatus();
            this.showToast('Changes reset', 'info');
        } catch (error) {
            console.error('Error resetting editor:', error);
            this.showToast('Failed to reset editor', 'error');
        }
    }

    async executeCurrentScript() {
        if (!this.currentScript) {
            this.showToast('No script selected', 'warning');
            return;
        }
        
        if (!this.currentScript.id) {
            this.showToast('Please save the script first', 'warning');
            return;
        }
        
        try {
            this.showLoading();
            const response = await fetch(`${this.apiBase}/scripts/${this.currentScript.id}/execute/`, {
                method: 'POST'
            });
            
            if (!response.ok) throw new Error('Failed to execute script');
            
            const result = await response.json();
            this.showExecutionResult(result);
            
            // Refresh execution data
            await this.loadExecutions();
            await this.loadStats();
            
        } catch (error) {
            console.error('Error executing script:', error);
            this.showToast('Failed to execute script: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    showExecutionResult(result) {
        // Create a formatted execution result display
        const executionDetails = `
            <div class="execution-result">
                <h4><i class="fas fa-play-circle"></i> Execution Result</h4>
                <div class="detail-grid">
                    <div class="detail-item">
                        <label>Script:</label>
                        <span>${result.filename}</span>
                    </div>
                    <div class="detail-item">
                        <label>Exit Code:</label>
                        <span class="${result.success ? 'success-text' : 'error-text'}">${result.exit_code}</span>
                    </div>
                    <div class="detail-item">
                        <label>Execution Time:</label>
                        <span>${result.execution_time_seconds}s</span>
                    </div>
                    <div class="detail-item">
                        <label>Status:</label>
                        <span class="status-badge ${result.success ? 'status-success' : 'status-failed'}">
                            ${result.success ? 'SUCCESS' : 'FAILED'}
                        </span>
                    </div>
                </div>
                
                ${result.stdout ? `
                    <h4><i class="fas fa-terminal"></i> Output</h4>
                    <div class="code-block">${result.stdout}</div>
                ` : ''}
                
                ${result.stderr ? `
                    <h4><i class="fas fa-exclamation-triangle"></i> Errors</h4>
                    <div class="code-block error-text">${result.stderr}</div>
                ` : ''}
            </div>
        `;
        
        document.getElementById('executionDetails').innerHTML = executionDetails;
        this.showModal('executionModal');
        
        // Also show a toast notification
        this.showToast(
            result.success ? 'Script executed successfully!' : 'Script execution failed',
            result.success ? 'success' : 'error'
        );
    }

    // User settings methods
    showUserSettings() {
        this.showModal('userSettingsModal');
        this.loadUserSettings();
    }

    async loadUserSettings() {
        try {
            const user = this.auth.user;
            document.getElementById('settingsUsername').textContent = user.username;
            document.getElementById('settingsEmail').textContent = user.email;
            document.getElementById('settingsRole').textContent = user.role;
            document.getElementById('settingsFullName').value = user.full_name || '';
            
            // Update 2FA status
            const twoFactorStatus = document.getElementById('twoFactorStatus');
            const enable2FABtn = document.getElementById('enable2FABtn');
            const disable2FABtn = document.getElementById('disable2FABtn');
            
            if (user.two_factor_enabled) {
                twoFactorStatus.innerHTML = '<i class="fas fa-check-circle" style="color: #28a745;"></i> Enabled';
                enable2FABtn.style.display = 'none';
                disable2FABtn.style.display = 'inline-flex';
            } else {
                twoFactorStatus.innerHTML = '<i class="fas fa-times-circle" style="color: #dc3545;"></i> Disabled';
                enable2FABtn.style.display = 'inline-flex';
                disable2FABtn.style.display = 'none';
            }
        } catch (error) {
            this.showToast('Error loading user settings: ' + error.message, 'error');
        }
    }

    async setup2FA() {
        try {
            this.showLoading();
            const response = await this.apiCall('/auth/2fa/setup', {
                method: 'POST'
            });
            
            // Show 2FA setup modal
            document.getElementById('qrCodeImage').src = response.qr_code;
            document.getElementById('backupCodes').innerHTML = response.backup_codes
                .map(code => `<code>${code}</code>`).join(' ');
            
            this.closeModal('userSettingsModal');
            this.showModal('setup2FAModal');
            
        } catch (error) {
            this.showToast('Error setting up 2FA: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async enable2FA() {
        const totpCode = document.getElementById('setup2FACode').value;
        if (!totpCode || totpCode.length !== 6) {
            this.showToast('Please enter a valid 6-digit code', 'error');
            return;
        }

        try {
            this.showLoading();
            const formData = new FormData();
            formData.append('totp_code', totpCode);
            
            await this.apiCall('/auth/2fa/enable', {
                method: 'POST',
                body: formData
            });
            
            this.showToast('2FA enabled successfully!', 'success');
            this.closeModal('setup2FAModal');
            
            // Update user info
            this.auth.user.two_factor_enabled = true;
            this.auth.updateUser(this.auth.user);
            
        } catch (error) {
            this.showToast('Error enabling 2FA: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async disable2FA() {
        const password = prompt('Enter your password to disable 2FA:');
        if (!password) return;

        try {
            this.showLoading();
            const formData = new FormData();
            formData.append('password', password);
            
            await this.apiCall('/auth/2fa/disable', {
                method: 'POST',
                body: formData
            });
            
            this.showToast('2FA disabled successfully!', 'success');
            
            // Update user info
            this.auth.user.two_factor_enabled = false;
            this.auth.updateUser(this.auth.user);
            this.loadUserSettings();
            
        } catch (error) {
            this.showToast('Error disabling 2FA: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async changePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (!currentPassword || !newPassword || !confirmPassword) {
            this.showToast('Please fill in all password fields', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            this.showToast('New passwords do not match', 'error');
            return;
        }

        if (newPassword.length < 8) {
            this.showToast('New password must be at least 8 characters long', 'error');
            return;
        }

        try {
            this.showLoading();
            await this.apiCall('/auth/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });
            
            this.showToast('Password changed successfully!', 'success');
            
            // Clear form
            document.getElementById('changePasswordForm').reset();
            
        } catch (error) {
            this.showToast('Error changing password: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    // User creation functionality
    showCreateUserModal() {
        this.showModal('createUserModal');
    }

    async createUser() {
        console.log('createUser() function called!');
        
        // Debug: Check current user and auth status
        console.log('Current user:', this.auth.user);
        console.log('User role:', this.auth.user?.role);
        console.log('Auth headers:', this.auth.getAuthHeaders());
        
        const username = document.getElementById('newUsername').value.trim();
        const email = document.getElementById('newEmail').value.trim();
        const fullName = document.getElementById('newFullName').value.trim();
        const password = document.getElementById('newUserPassword').value;
        const confirmPassword = document.getElementById('newUserConfirmPassword').value;
        const role = document.getElementById('newUserRole').value;

        // Debug: Log all values to see what's happening
        console.log('Create User Debug:', {
            username: `"${username}"`,
            email: `"${email}"`,
            fullName: `"${fullName}"`,
            password: password ? `"${'*'.repeat(password.length)}"` : '""',
            confirmPassword: confirmPassword ? `"${'*'.repeat(confirmPassword.length)}"` : '""',
            role: `"${role}"`
        });

        // Validation (Full Name is optional)
        if (!username || !email || !password || !confirmPassword || !role) {
            console.log('Validation failed. Empty fields:', {
                username: !username,
                email: !email,
                password: !password,
                confirmPassword: !confirmPassword,
                role: !role
            });
            this.showToast('Please fill in all required fields', 'error');
            return;
        }

        if (password !== confirmPassword) {
            this.showToast('Passwords do not match', 'error');
            return;
        }

        if (password.length < 8) {
            this.showToast('Password must be at least 8 characters long', 'error');
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            this.showToast('Please enter a valid email address', 'error');
            return;
        }

        try {
            this.showLoading();
            await this.apiCall('/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: username,
                    email: email,
                    full_name: fullName,
                    password: password,
                    role: role
                })
            });
            
            this.showToast('User created successfully!', 'success');
            this.closeModal('createUserModal');
            
            // Reset form
            document.getElementById('createUserForm').reset();
            
            // Reload user management table
            await this.loadUserManagement();
            
        } catch (error) {
            this.showToast('Error creating user: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    // Admin Panel Functions
    async loadUserManagement() {
        try {
            this.showLoading();
            const users = await this.apiCall('/auth/users');
            this.displayUsersTable(users);
        } catch (error) {
            this.showToast('Error loading users: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    displayUsersTable(users) {
        const container = document.getElementById('usersTableContainer');
        if (!container) return;

        const html = `
            <div class="users-table">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th>2FA</th>
                            <th>Last Login</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map(user => `
                            <tr>
                                <td>
                                    <div class="user-info-cell">
                                        <div class="user-avatar-small">${user.full_name.charAt(0).toUpperCase()}</div>
                                        <div>
                                            <div class="user-name">${user.full_name}</div>
                                            <div class="user-email">${user.email}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <select class="role-select" data-user-id="${user.id}" onchange="app.updateUserRole(${user.id}, this.value)">
                                        <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                                        <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
                                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                                    </select>
                                </td>
                                <td>
                                    <select class="status-select" data-user-id="${user.id}" onchange="app.updateUserStatus(${user.id}, this.value)">
                                        <option value="active" ${user.is_active ? 'selected' : ''}>Active</option>
                                        <option value="inactive" ${!user.is_active ? 'selected' : ''}>Inactive</option>
                                    </select>
                                </td>
                                <td>
                                    <span class="status-badge ${user.two_factor_enabled ? 'success' : 'warning'}">
                                        ${user.two_factor_enabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                </td>
                                <td>
                                    ${user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}
                                </td>
                                <td>
                                    <div class="action-buttons">
                                        <button class="btn btn-small btn-secondary" onclick="app.viewUserAuditLog(${user.id})" title="View Audit Log">
                                            <i class="fas fa-history"></i>
                                        </button>
                                        <button class="btn btn-small btn-danger" onclick="app.resetUser2FA(${user.id})" title="Reset  2FA">
                                            <i class="fas fa-key"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = html;
    }

    async updateUserRole(userId, newRole) {
        try {
            await this.apiCall(`/auth/users/${userId}/role`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ role: newRole })
            });
            this.showToast('User role updated successfully', 'success');
        } catch (error) {
            this.showToast('Error updating user role: ' + error.message, 'error');
            // Reload the table to revert the change
            this.loadUserManagement();
        }
    }

    async updateUserStatus(userId, status) {
        const isActive = status === 'active';
        try {
            await this.apiCall(`/auth/users/${userId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ is_active: isActive })
            });
            this.showToast(`User ${isActive ? 'activated' : 'deactivated'} successfully`, 'success');
        } catch (error) {
            this.showToast('Error updating user status: ' + error.message, 'error');
            // Reload the table to revert the change
            this.loadUserManagement();
        }
    }

    async resetUser2FA(userId) {
        if (!confirm('Are you sure you want to reset 2FA for this user? They will need to set it up again.')) {
            return;
        }

        try {
            await this.apiCall(`/auth/users/${userId}/reset-2fa`, {
                method: 'POST'
            });
            this.showToast('2FA reset successfully', 'success');
            this.loadUserManagement(); // Reload to update the table
        } catch (error) {
            this.showToast('Error resetting 2FA: ' + error.message, 'error');
        }
    }

    async loadRBACMatrix() {
        try {
            this.showLoading();
            const matrix = await this.apiCall('/admin/rbac-matrix/');
            this.displayRBACMatrix(matrix);
        } catch (error) {
            this.showToast('Error loading RBAC matrix: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    displayRBACMatrix(matrix) {
                             const container = document.getElementById('rbacMatrixContainer');
        if (!container) return;

        const roles = ['viewer', 'editor', 'admin'];
        const permissions = [
            'scripts:read', 'scripts:write', 'scripts:delete', 'scripts:execute',
            'schedules:read', 'schedules:write', 'schedules:delete',
            'executions:read',
            'users:read', 'users:write', 'audit:read'
        ];

        const html = `
            <div class="rbac-matrix">
                <table class="data-table rbac-table">
                    <thead>
                        <tr>
                            <th>Permission</th>
                            ${roles.map(role => `<th class="role-header">${role.charAt(0).toUpperCase() + role.slice(1)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${permissions.map(permission => `
                            <tr>
                                <td class="permission-name">${permission}</td>
                                ${roles.map(role => {
                                    const hasPermission = matrix[role] && matrix[role].includes(permission);
                                    return `
                                        <td class="permission-cell">
                                            <span class="permission-indicator ${hasPermission ? 'granted' : 'denied'}">
                                                <i class="fas ${hasPermission ? 'fa-check' : 'fa-times'}"></i>
                                            </span>
                                        </td>
                                    `;
                                }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = html;
    }

    async loadAuditLog() {
        try {
            this.showLoading();
            const logs = await this.apiCall('/admin/audit-logs/');
            this.displayAuditLog(logs);
        } catch (error) {
            this.showToast('Error loading audit log: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    displayAuditLog(logs) {
        const container = document.getElementById('auditLogContainer');
        if (!container) return;

        const html = `
            <div class="audit-log">
                <div class="audit-controls">
                    <input type="text" id="auditSearch" placeholder="Search audit logs..." class="search-input">
                    <select id="auditActionFilter" class="filter-select">
                        <option value="">All Actions</option>
                        <option value="login">Login</option>
                        <option value="logout">Logout</option>
                        <option value="script_upload">Script Upload</option>
                        <option value="script_execute">Script Execute</option>
                        <option value="script_delete">Script Delete</option>
                        <option value="schedule_create">Schedule Create</option>
                        <option value="schedule_delete">Schedule Delete</option>
                        <option value="user_role_change">User Role Change</option>
                        <option value="user_status_change">User Status Change</option>
                    </select>
                    <button class="btn btn-secondary" onclick="app.loadAuditLog()">
                        <i class="fas fa-refresh"></i> Refresh
                    </button>
                </div>
                <table class="data-table audit-table">
                    <thead>
                        <tr>
                            <th>Timestamp</th>
                            <th>User</th>
                            <th>Action</th>
                            <th>Resource</th>
                            <th>IP Address</th>
                            <th>Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => `
                            <tr>
                                <td class="timestamp">${new Date(log.timestamp).toLocaleString()}</td>
                                <td class="user-cell">
                                    <div class="user-avatar-tiny">${log.user_email ? log.user_email.charAt(0).toUpperCase() : '?'}</div>
                                    <span>${log.user_email || log.user_id || 'Unknown User'}</span>
                                </td>
                                <td>
                                    <span class="action-badge action-${log.action.replace('_', '-')}">${log.action.replace('_', ' ')}</span>
                                </td>
                                <td>${log.resource || '-'}</td>
                                <td class="ip-address">${log.ip_address || '-'}</td>
                                <td class="details">${log.details || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = html;

        // Add search and filter functionality
        this.setupAuditLogFilters();
    }

    setupAuditLogFilters() {
        const searchInput = document.getElementById('auditSearch');
        const actionFilter = document.getElementById('auditActionFilter');
        
        if (searchInput) {
            searchInput.addEventListener('input', () => this.filterAuditLog());
        }
        
        if (actionFilter) {
            actionFilter.addEventListener('change', () => this.filterAuditLog());
        }
    }

    filterAuditLog() {
        const searchTerm = document.getElementById('auditSearch')?.value.toLowerCase() || '';
        const actionFilter = document.getElementById('auditActionFilter')?.value || '';
        const rows = document.querySelectorAll('.audit-table tbody tr');

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            const rowText = Array.from(cells).map(cell => cell.textContent.toLowerCase()).join(' ');
            const action = cells[2]?.textContent.toLowerCase().replace(' ', '_') || '';
            
            const matchesSearch = !searchTerm || rowText.includes(searchTerm);
            const matchesAction = !actionFilter || action.includes(actionFilter);
            
            row.style.display = matchesSearch && matchesAction ? '' : 'none';
        });
    }

    async viewUserAuditLog(userId) {
        try {
            this.showLoading();
            const logs = await this.apiCall(`/admin/audit-logs/?user_id=${userId}`);
            // Create a modal or separate view for user-specific audit log
            this.showUserAuditModal(logs);
        } catch (error) {
            this.showToast('Error loading user audit log: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    showUserAuditModal(logs) {
        // This would create a modal with user-specific audit logs
        // For now, we'll just show a toast with the count
        this.showToast(`Found ${logs.length} audit log entries for this user`, 'info');
    }

    // Admin panel initialization
    async initAdminPanel() {
        if (this.auth.user && (this.auth.user.role === 'admin')) {
            // Show admin tab
            const adminTab = document.getElementById('adminTab');
            if (adminTab) {
                adminTab.style.display = 'block';
            }
            
            // Load admin data when admin tab is selected
            if (this.currentTab === 'admin') {
                await this.loadAdminData();
            }
        }
    }

    async loadAdminData() {
        await Promise.all([
            this.loadUserManagement(),
            this.loadRBACMatrix(),
            this.loadAuditLog()
        ]);
    }

    // API call helper method
    async apiCall(endpoint, options = {}) {
        const url = `${this.apiBase}${endpoint}`;
        const config = {
            headers: {
                ...this.auth.getAuthHeaders(),
                ...(options.headers || {})
            },
            ...options
        };

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                // Handle authentication errors
                if (response.status === 401) {
                    this.auth.redirectToLogin();
                    throw new Error('Authentication required');
                }
                
                // Try to get error message from response
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorData.message || errorMessage;
                } catch (e) {
                    // If we can't parse the error response, use the status text
                    errorMessage = response.statusText || errorMessage;
                }
                
                throw new Error(errorMessage);
            }

            // Check if the response has content
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                return await response.text();
            }
        } catch (error) {
            console.error('API call failed:', error);
            throw error;
        }
    }

    // Show the loading overlay
    showLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.style.display = 'flex';
    }

    // Hide the loading overlay
    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    // Show a toast notification
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 500);
        }, duration);
    }

    // Show a modal dialog
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
            // Focus on first input if available
            const firstInput = modal.querySelector('input, textarea, select');
            if (firstInput) {
                setTimeout(() => firstInput.focus(), 100);
            }
        }
    }

    // Close a modal dialog
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Schedule a script for execution
    scheduleScript(scriptId) {
        this.createScheduleForScript(scriptId);
    }

    // Delete a script
    async deleteScript(scriptId) {
        if (!confirm('Are you sure you want to delete this script? This action cannot be undone.')) {
            return;
        }

        this.showLoading();
        try {
            await this.apiCall(`/scripts/${scriptId}`, {
                method: 'DELETE'
            });
            
            this.showToast('Script deleted successfully!', 'success');
            await this.loadScripts();
            await this.loadStats();
        } catch (error) {
            this.showToast('Failed to delete script: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    // View execution history for a script
    viewExecutionHistory(scriptId) {
        this.viewScriptExecutions(scriptId);
    }

    // Show help modal
    showHelpModal() {
        this.showModal('helpModal');
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Create global app instance
    window.app = new ScriptPilot();
});
