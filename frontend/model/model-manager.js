/**
 * n0th1ng AI - Model Manager Frontend Architecture
 * Paradigm: Completely Backend-Driven, Capability-Based, Event-Driven OOP.
 */

// ============================================================================
// 1. CORE SYSTEM: EVENT BUS (Pub/Sub)
// ============================================================================
class EventManager {
    constructor() {
        this.listeners = {};
    }

    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    emit(event, data = {}) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (err) {
                console.error(`[EventBus] Error in listener for ${event}:`, err);
            }
        });
    }
}
const Events = new EventManager();

// Standardized Application Events
const EventTypes = {
    SYSTEM_READY: 'SYSTEM_READY',
    DATA_SYNCED: 'DATA_SYNCED',
    FILTER_CHANGED: 'FILTER_CHANGED',
    SEARCH_UPDATED: 'SEARCH_UPDATED',
    ACTION_TRIGGERED: 'ACTION_TRIGGERED',
    DOWNLOAD_STARTED: 'DOWNLOAD_STARTED',
    DOWNLOAD_PROGRESS: 'DOWNLOAD_PROGRESS'
};

// ============================================================================
// 2. CORE SYSTEM: API MANAGER (The Source of Truth)
// ============================================================================
class ApiManager {
    constructor() {
        // In a real environment, this utilizes fetch(). 
        // Here, we simulate the backend JSON responses that dictate the ENTIRE UI.
    }

    async getSystemState() {
        // Simulating network delay
        return new Promise(resolve => setTimeout(() => {
            resolve({
                categories: [
                    { id: 'all', label: 'All Packages', count: 124 },
                    { id: 'speech', label: 'Speech Synthesis', count: 12 },
                    { id: 'vision', label: 'Vision & OCR', count: 8 },
                    { id: 'llm', label: 'Language Models', count: 45 },
                    { id: 'deps', label: 'Dependencies', count: 59 }
                ],
                overview: [
                    { id: 'stat_1', label: 'Installed Packages', value: '34' },
                    { id: 'stat_2', label: 'Available Updates', value: '3' },
                    { id: 'stat_3', label: 'Active Workers', value: '2' },
                    { id: 'stat_4', label: 'Storage Used', value: '142 GB' }
                ],
                packages: [
                    {
                        id: 'pkg_kokoro_v1',
                        name: 'Kokoro TTS',
                        version: '1.2.0',
                        category: 'speech',
                        description: 'High-fidelity local text-to-speech engine.',
                        installed: true,
                        capabilities: ['supportsModels', 'supportsVoices', 'supportsStreaming'],
                        actions: [
                            { id: 'act_settings', label: 'Settings', type: 'secondary', event: 'OPEN_SETTINGS' },
                            { id: 'act_update', label: 'Update', type: 'primary', event: 'UPDATE_PACKAGE' }
                        ]
                    },
                    {
                        id: 'pkg_llama_vision',
                        name: 'Llama Vision 8B',
                        version: '1.0.0',
                        category: 'vision',
                        description: 'Multimodal vision instruction model.',
                        installed: false,
                        capabilities: ['supportsWorkers', 'requiresGPU', 'supportsBenchmarks'],
                        actions: [
                            { id: 'act_install', label: 'Install Package', type: 'primary', event: 'INSTALL_PACKAGE' }
                        ]
                    },
                    {
                        id: 'pkg_ffmpeg_core',
                        name: 'FFmpeg Core',
                        version: '6.1.1',
                        category: 'deps',
                        description: 'System dependency for audio/video processing.',
                        installed: true,
                        capabilities: ['isDependency', 'isSystemCritical'],
                        actions: [
                            { id: 'act_repair', label: 'Repair', type: 'secondary', event: 'REPAIR_PACKAGE' },
                            { id: 'act_remove', label: 'Remove', type: 'danger', event: 'REMOVE_PACKAGE' }
                        ]
                    }
                ]
            });
        }, 300));
    }
}
const API = new ApiManager();

// ============================================================================
// 3. CORE SYSTEM: STATE MANAGER
// ============================================================================
class StateManager {
    constructor() {
        this.state = {
            activeCategory: 'all',
            searchQuery: '',
            packages: [],
            categories: [],
            overview: []
        };
    }

    set(key, value) {
        this.state[key] = value;
        // Decoupled state updates
        if (key === 'activeCategory') Events.emit(EventTypes.FILTER_CHANGED, value);
        if (key === 'searchQuery') Events.emit(EventTypes.SEARCH_UPDATED, value);
    }

    get(key) {
        return this.state[key];
    }

    updateDataSync(serverData) {
        this.state.packages = serverData.packages;
        this.state.categories = serverData.categories;
        this.state.overview = serverData.overview;
        Events.emit(EventTypes.DATA_SYNCED, this.state);
    }
}
const State = new StateManager();

// ============================================================================
// 4. UI ARCHITECTURE: COMPONENT FACTORY (Generic Rendering)
// ============================================================================
class ComponentFactory {
    
    /**
     * Builds a DOM element generically from a JSON configuration object.
     */
    static createElement({ tag = 'div', className = '', text = '', html = '', attributes = {}, events = {} }) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text) el.textContent = text;
        if (html) el.innerHTML = html;
        
        Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v));
        Object.entries(events).forEach(([eventName, handler]) => el.addEventListener(eventName, handler));
        
        return el;
    }

    /**
     * Dynamically renders a card based solely on data capabilities and actions.
     * No hardcoding of provider types or categories.
     */
    static createPackageCard(pkgData) {
        const card = this.createElement({ tag: 'article', className: 'package-card glass-liquid' });
        
        // Header
        const header = this.createElement({ tag: 'div', className: 'card-header' });
        const titleBlock = this.createElement({ tag: 'div' });
        titleBlock.appendChild(this.createElement({ tag: 'h3', className: 'card-title', text: pkgData.name }));
        titleBlock.appendChild(this.createElement({ tag: 'span', className: 'card-meta', text: `v${pkgData.version}` }));
        
        // Status Badge
        const statusClass = pkgData.installed ? 'cap-badge healthy' : 'cap-badge';
        const statusText = pkgData.installed ? 'Installed' : 'Available';
        const status = this.createElement({ tag: 'span', className: statusClass, text: statusText });
        
        header.appendChild(titleBlock);
        header.appendChild(status);
        card.appendChild(header);

        // Description
        card.appendChild(this.createElement({ tag: 'p', className: 'card-desc', text: pkgData.description }));

        // Dynamic Capabilities
        if (pkgData.capabilities && pkgData.capabilities.length > 0) {
            const capContainer = this.createElement({ tag: 'div', className: 'card-capabilities' });
            pkgData.capabilities.forEach(cap => {
                // Formats "supportsStreaming" to "Supports Streaming" dynamically
                const formattedCap = cap.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                capContainer.appendChild(this.createElement({ tag: 'span', className: 'cap-badge', text: formattedCap }));
            });
            card.appendChild(capContainer);
        }

        // Dynamic Actions
        if (pkgData.actions && pkgData.actions.length > 0) {
            const actionContainer = this.createElement({ tag: 'div', className: 'card-actions' });
            pkgData.actions.forEach(action => {
                const btnClass = `btn btn-${action.type}`;
                const btn = this.createElement({ 
                    tag: 'button', 
                    className: btnClass, 
                    text: action.label,
                    events: {
                        click: () => Events.emit(EventTypes.ACTION_TRIGGERED, { action: action.event, payload: pkgData })
                    }
                });
                actionContainer.appendChild(btn);
            });
            card.appendChild(actionContainer);
        }

        return card;
    }
}

// ============================================================================
// 5. MANAGERS (Domain Specific Handlers)
// ============================================================================

class FilterManager {
    constructor(rootId) {
        this.root = document.getElementById(rootId);
        this.bindEvents();
    }

    bindEvents() {
        Events.on(EventTypes.DATA_SYNCED, (state) => this.render(state.categories));
        Events.on(EventTypes.FILTER_CHANGED, (activeId) => this.updateSelection(activeId));
        
        const searchInput = document.getElementById('global-search');
        if(searchInput) {
            searchInput.addEventListener('input', (e) => State.set('searchQuery', e.target.value.toLowerCase()));
        }
    }

    render(categories) {
        this.root.innerHTML = '';
        categories.forEach(cat => {
            const el = ComponentFactory.createElement({ 
                tag: 'div', 
                className: 'category-item',
                events: { click: () => State.set('activeCategory', cat.id) }
            });
            
            el.dataset.id = cat.id;
            el.appendChild(ComponentFactory.createElement({ tag: 'span', text: cat.label }));
            el.appendChild(ComponentFactory.createElement({ tag: 'span', className: 'category-badge', text: cat.count }));
            this.root.appendChild(el);
        });
        this.updateSelection(State.get('activeCategory'));
    }

    updateSelection(activeId) {
        Array.from(this.root.children).forEach(child => {
            child.classList.toggle('active', child.dataset.id === activeId);
        });
    }
}

class OverviewManager {
    constructor(rootId) {
        this.root = document.getElementById(rootId);
        Events.on(EventTypes.DATA_SYNCED, (state) => this.render(state.overview));
    }

    render(overviewData) {
        this.root.innerHTML = '';
        overviewData.forEach(stat => {
            const card = ComponentFactory.createElement({ tag: 'div', className: 'overview-card glass' });
            card.appendChild(ComponentFactory.createElement({ tag: 'div', className: 'overview-label', text: stat.label }));
            card.appendChild(ComponentFactory.createElement({ tag: 'div', className: 'overview-value text-aurora', text: stat.value }));
            this.root.appendChild(card);
        });
    }
}

class PackageManager {
    constructor(rootId) {
        this.root = document.getElementById(rootId);
        Events.on(EventTypes.DATA_SYNCED, () => this.render());
        Events.on(EventTypes.FILTER_CHANGED, () => this.render());
        Events.on(EventTypes.SEARCH_UPDATED, () => this.render());
    }

    render() {
        this.root.innerHTML = '';
        const activeCategory = State.get('activeCategory');
        const query = State.get('searchQuery');
        const allPackages = State.get('packages');

        const filtered = allPackages.filter(pkg => {
            const matchesCat = activeCategory === 'all' || pkg.category === activeCategory;
            const matchesSearch = pkg.name.toLowerCase().includes(query) || pkg.description.toLowerCase().includes(query);
            return matchesCat && matchesSearch;
        });

        filtered.forEach(pkg => {
            this.root.appendChild(ComponentFactory.createPackageCard(pkg));
        });
    }
}

class ActionManager {
    constructor() {
        Events.on(EventTypes.ACTION_TRIGGERED, this.handleAction.bind(this));
    }

    handleAction(data) {
        const { action, payload } = data;
        console.log(`[ActionManager] Executing backend action: ${action} for ${payload.id}`);
        
        // This is where generic actions are routed to the API
        if (action === 'INSTALL_PACKAGE') {
            Events.emit(EventTypes.DOWNLOAD_STARTED, { id: payload.id, name: payload.name });
            // Simulate download progress via backend websocket/events
            this.simulateDownload(payload.id);
        }
    }

    simulateDownload(pkgId) {
        let progress = 0;
        const interval = setInterval(() => {
            progress += 15;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                setTimeout(() => Events.emit(EventTypes.SYSTEM_READY), 500); // Trigger re-render
            }
            Events.emit(EventTypes.DOWNLOAD_PROGRESS, { id: pkgId, progress });
        }, 400);
    }
}

class DownloadManager {
    constructor(rootId) {
        this.root = document.getElementById(rootId);
        this.activeDownloads = new Map();
        
        Events.on(EventTypes.DOWNLOAD_STARTED, this.onStart.bind(this));
        Events.on(EventTypes.DOWNLOAD_PROGRESS, this.onProgress.bind(this));
    }

    onStart(data) {
        this.root.classList.remove('hidden');
        this.activeDownloads.set(data.id, data);
        this.render();
    }

    onProgress(data) {
        if (!this.activeDownloads.has(data.id)) return;
        const dl = this.activeDownloads.get(data.id);
        dl.progress = data.progress;
        
        if (dl.progress >= 100) {
            this.activeDownloads.delete(data.id);
            if (this.activeDownloads.size === 0) {
                setTimeout(() => this.root.classList.add('hidden'), 1000);
            }
        }
        this.render();
    }

    render() {
        this.root.innerHTML = '';
        this.activeDownloads.forEach(dl => {
            const container = ComponentFactory.createElement({ tag: 'div' });
            
            const header = ComponentFactory.createElement({ tag: 'div', className: 'dock-header' });
            header.appendChild(ComponentFactory.createElement({ tag: 'span', text: `Downloading ${dl.name}...` }));
            header.appendChild(ComponentFactory.createElement({ tag: 'span', text: `${dl.progress || 0}%` }));
            
            const track = ComponentFactory.createElement({ tag: 'div', className: 'progress-track' });
            const fill = ComponentFactory.createElement({ tag: 'div', className: 'progress-fill' });
            fill.style.width = `${dl.progress || 0}%`;
            track.appendChild(fill);
            
            container.appendChild(header);
            container.appendChild(track);
            this.root.appendChild(container);
        });
    }
}

// ============================================================================
// 6. APPLICATION BOOTSTRAP
// ============================================================================
class App {
    static async init() {
        console.log('[App] Initializing Model Manager Architecture...');

        // Initialize decoupled managers
        new FilterManager('sidebar-categories-root');
        new OverviewManager('overview-root');
        new PackageManager('workspace-grid-root');
        new ActionManager();
        new DownloadManager('download-dock-root');

        // Initial Data Fetch Loop
        Events.on(EventTypes.SYSTEM_READY, async () => {
            const serverData = await API.getSystemState();
            State.updateDataSync(serverData);
        });

        // Trigger startup
        Events.emit(EventTypes.SYSTEM_READY);
    }
}

// Boot application when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());