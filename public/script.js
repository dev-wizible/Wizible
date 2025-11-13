class EnhancedResumeProcessor {
  constructor() {
    this.apiBaseUrl = this.detectApiBaseUrl();
    this.currentBatchId = null;
    this.files = [];
    this.extracted = false;
    this.configured = false;
    this.currentFolder = null;
    this.folders = [];

    this.initializeEventListeners();
    this.loadFolders();
    this.addLog("System initialized - ready for resume processing", "info");
    this.checkServerConnection();
  }

  detectApiBaseUrl() {
    const currentOrigin = window.location.origin;
    if (
      currentOrigin.includes("127.0.0.1:5500") ||
      currentOrigin.includes("file://") ||
      currentOrigin.includes("localhost:5500")
    ) {
      return "http://localhost:3000";
    } else {
      return currentOrigin;
    }
  }

  async checkServerConnection() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/health`);
      if (response.ok) {
        this.addLog("✅ Connected to server successfully", "success");
        this.addLog("🤖 AI Services: LlamaIndex + OpenAI + Anthropic", "info");
        this.addLog("📁 Dynamic folder management enabled", "info");
      } else {
        throw new Error(`Server responded with status ${response.status}`);
      }
    } catch (error) {
      this.addLog(`❌ Cannot connect to server at ${this.apiBaseUrl}`, "error");
      this.addLog(
        "Please ensure the Node.js server is running on port 3000",
        "warning"
      );
    }
  }

  initializeEventListeners() {
    // Folder Management
    const safeAddEventListener = (id, event, handler) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener(event, handler);
      }
    };

    // Folder management buttons
    safeAddEventListener(
      "createFolderBtn",
      "click",
      this.showCreateFolderModal.bind(this)
    );
    safeAddEventListener(
      "refreshFoldersBtn",
      "click",
      this.loadFolders.bind(this)
    );

    // Modal controls
    safeAddEventListener(
      "cancelCreateFolder",
      "click",
      this.hideCreateFolderModal.bind(this)
    );
    safeAddEventListener(
      "confirmCreateFolder",
      "click",
      this.createFolder.bind(this)
    );
    safeAddEventListener(
      "cancelDeleteFolder",
      "click",
      this.hideDeleteFolderModal.bind(this)
    );
    safeAddEventListener(
      "confirmDeleteFolder",
      "click",
      this.confirmDeleteFolder.bind(this)
    );

    // Form validation for folder creation
    safeAddEventListener(
      "newFolderName",
      "input",
      this.validateFolderForm.bind(this)
    );
    safeAddEventListener(
      "newFolderDisplayName",
      "input",
      this.validateFolderForm.bind(this)
    );

    // File upload (existing)
    const fileUploadArea = document.getElementById("fileUploadArea");
    const fileInput = document.getElementById("fileInput");

    if (fileUploadArea && fileInput) {
      fileUploadArea.addEventListener("click", () => fileInput.click());
      fileUploadArea.addEventListener(
        "dragover",
        this.handleDragOver.bind(this)
      );
      fileUploadArea.addEventListener(
        "dragleave",
        this.handleDragLeave.bind(this)
      );
      fileUploadArea.addEventListener("drop", this.handleDrop.bind(this));
      fileInput.addEventListener("change", this.handleFileSelect.bind(this));
    }

    // Step buttons (existing)
    safeAddEventListener(
      "convertToJson",
      "click",
      this.convertToJson.bind(this)
    );
    safeAddEventListener(
      "saveConfig",
      "click",
      this.saveConfiguration.bind(this)
    );
    safeAddEventListener(
      "startEvaluation",
      "click",
      this.startEvaluation.bind(this)
    );

    // Download buttons (existing)
    safeAddEventListener("downloadExtractionsAlways", "click", () =>
      this.downloadResults("extractions")
    );
    safeAddEventListener("downloadAllScores", "click", () =>
      this.downloadAllScores()
    );
    
    // New scoring button for multi-model evaluation
    safeAddEventListener(
      "startScoring",
      "click",
      this.startMultiModelScoring.bind(this)
    );

    // Configuration validation (with better event handling)
    const jobDescElement = document.getElementById("jobDescription");
    const rubricElement = document.getElementById("evaluationRubric");

    if (jobDescElement && rubricElement) {
      // Use both 'input' and 'keyup' events for better responsiveness
      jobDescElement.addEventListener("input", () => {
        console.log("📝 Job description changed");
        this.validateAndUpdateConfigButton();
      });

      jobDescElement.addEventListener("keyup", () => {
        this.validateAndUpdateConfigButton();
      });

      rubricElement.addEventListener("input", () => {
        console.log("📝 Evaluation rubric changed");
        this.validateAndUpdateConfigButton();
      });

      rubricElement.addEventListener("keyup", () => {
        this.validateAndUpdateConfigButton();
      });
    }

    // Modal close on overlay click
    document
      .getElementById("createFolderModal")
      ?.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) this.hideCreateFolderModal();
      });
    document
      .getElementById("deleteFolderModal")
      ?.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) this.hideDeleteFolderModal();
      });
  }

  // =====================================================
  // FOLDER MANAGEMENT METHODS
  // =====================================================

  async loadFolders() {
    try {
      this.addLog("🔄 Loading folders...", "info");

      const response = await fetch(`${this.apiBaseUrl}/api/folders`);
      const result = await response.json();

      if (result.success) {
        this.folders = result.data.folders;
        this.currentFolder = result.data.currentFolder;

        // Try to restore last selected folder from localStorage
        await this.restoreLastSelectedFolder();

        this.renderFolders();
        this.updateCurrentFolderDisplay();

        // Load configuration for current folder (after any folder restoration)
        await this.loadFolderConfiguration();

        this.addLog(`📁 Loaded ${this.folders.length} folders`, "success");
      } else {
        this.addLog(`Failed to load folders: ${result.error}`, "error");
      }
    } catch (error) {
      this.addLog(`Error loading folders: ${error.message}`, "error");
    }
  }

  async restoreLastSelectedFolder() {
    try {
      const lastSelectedFolder = localStorage.getItem("lastSelectedFolder");

      if (lastSelectedFolder) {
        // Check if the folder still exists
        const folderExists = this.folders.find(
          (f) => f.name === lastSelectedFolder
        );

        if (folderExists && lastSelectedFolder !== this.currentFolder) {
          this.addLog(
            `🔄 Restoring last selected folder: ${lastSelectedFolder}`,
            "info"
          );

          // Switch to the last selected folder
          const response = await fetch(
            `${this.apiBaseUrl}/api/current-folder`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ folderName: lastSelectedFolder }),
            }
          );

          const result = await response.json();

          if (result.success) {
            this.currentFolder = lastSelectedFolder;
            this.addLog(`✅ Restored folder: ${lastSelectedFolder}`, "success");
          } else {
            this.addLog(`Failed to restore folder: ${result.error}`, "warning");
            // Clear invalid folder from localStorage
            localStorage.removeItem("lastSelectedFolder");
          }
        }
      }
    } catch (error) {
      this.addLog(`Error restoring folder: ${error.message}`, "warning");
      // Clear problematic folder from localStorage
      localStorage.removeItem("lastSelectedFolder");
    }
  }

  renderFolders() {
    const foldersGrid = document.getElementById("foldersGrid");
    if (!foldersGrid) return;

    foldersGrid.innerHTML = this.folders
      .map(
        (folder) => `
          <div class="folder-card ${
            folder.name === this.currentFolder ? "active" : ""
          }" 
               data-folder="${folder.name}"
               onclick="processor.selectFolder('${folder.name}')">
            <div class="folder-card-header">
              <div class="folder-name">
                📁 ${folder.displayName}
              </div>
              <div class="folder-menu">
                <button class="folder-menu-btn" 
                        onclick="event.stopPropagation(); processor.showDeleteFolderModal('${
                          folder.name
                        }', '${folder.displayName}')"
                        title="Delete folder"
                        ${
                          folder.name === "main" || folder.name === "test"
                            ? 'style="display:none"'
                            : ""
                        }>
                  🗑️
                </button>
              </div>
            </div>
            <div class="folder-stats">
              <div class="folder-stat">
                <div class="folder-stat-value">${
                  folder.stats?.totalFiles || 0
                }</div>
                <div class="folder-stat-label">Total</div>
              </div>
              <div class="folder-stat">
                <div class="folder-stat-value">${
                  folder.stats?.extractedFiles || 0
                }</div>
                <div class="folder-stat-label">Extracted</div>
              </div>
              <div class="folder-stat">
                <div class="folder-stat-value">${
                  folder.stats?.scoredFiles || 0
                }</div>
                <div class="folder-stat-label">Scored</div>
              </div>
              <div class="folder-stat">
                <div class="folder-stat-value">${
                  folder.stats?.validatedFiles || 0
                }</div>
                <div class="folder-stat-label">Validated</div>
              </div>
            </div>
          </div>
        `
      )
      .join("");
  }

  async selectFolder(folderName) {
    try {
      this.addLog(`🔄 Switching to folder: ${folderName}`, "info");

      const response = await fetch(`${this.apiBaseUrl}/api/current-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderName }),
      });

      const result = await response.json();

      if (result.success) {
        this.currentFolder = folderName;

        // Save the selected folder to localStorage
        localStorage.setItem("lastSelectedFolder", folderName);

        this.addLog(
          `✅ Switched to folder: ${
            result.data.folderInfo?.displayName || folderName
          }`,
          "success"
        );

        // Re-render folders to update active state
        this.renderFolders();
        this.updateCurrentFolderDisplay();

        // Reset extraction status and re-detect files
        this.extracted = false;
        await this.detectExtractedFiles();

        // Load configuration for this folder
        await this.loadFolderConfiguration();

        this.updateStepStatus();
      } else {
        this.addLog(`Failed to switch folder: ${result.error}`, "error");
      }
    } catch (error) {
      this.addLog(`Error switching folder: ${error.message}`, "error");
    }
  }

  async loadFolderConfiguration() {
    try {
      this.addLog("🔧 Loading folder configuration...", "info");

      const response = await fetch(`${this.apiBaseUrl}/api/config`);
      const result = await response.json();

      if (result.success && result.data.configured) {
        // Fill in the configuration fields
        const jobDescElement = document.getElementById("jobDescription");
        const rubricElement = document.getElementById("evaluationRubric");

        if (jobDescElement && rubricElement) {
          jobDescElement.value = result.data.jobDescription;
          rubricElement.value = result.data.evaluationRubric;

          // Mark as configured
          this.configured = true;

          // Trigger validation to enable the save button
          this.validateAndUpdateConfigButton();

          this.addLog(
            `✅ Loaded configuration for folder (${result.data.jobDescriptionLength} + ${result.data.evaluationRubricLength} characters)`,
            "success"
          );
        }
      } else {
        // Clear configuration fields
        const jobDescElement = document.getElementById("jobDescription");
        const rubricElement = document.getElementById("evaluationRubric");

        if (jobDescElement && rubricElement) {
          jobDescElement.value = "";
          rubricElement.value = "";
        }

        this.configured = false;
        this.validateAndUpdateConfigButton();

        this.addLog("📝 No configuration found for this folder", "info");
      }
    } catch (error) {
      this.addLog(`Error loading configuration: ${error.message}`, "error");
      this.configured = false;
    }
  }

  updateCurrentFolderDisplay() {
    const currentFolderNameEl = document.getElementById("currentFolderName");
    const currentFolderPathEl = document.getElementById("currentFolderPath");

    if (currentFolderNameEl && currentFolderPathEl) {
      const folder = this.folders.find((f) => f.name === this.currentFolder);
      if (folder) {
        currentFolderNameEl.textContent = folder.displayName;
        currentFolderPathEl.textContent = folder.path;
      }
    }
  }

  showCreateFolderModal() {
    const modal = document.getElementById("createFolderModal");
    if (modal) {
      modal.classList.add("active");
      // Focus on the name input
      setTimeout(() => {
        document.getElementById("newFolderName")?.focus();
      }, 300);
    }
  }

  hideCreateFolderModal() {
    const modal = document.getElementById("createFolderModal");
    if (modal) {
      modal.classList.remove("active");
      // Clear form
      document.getElementById("newFolderName").value = "";
      document.getElementById("newFolderDisplayName").value = "";
      this.validateFolderForm();
    }
  }

  showDeleteFolderModal(folderName, displayName) {
    // Prevent deletion of default folders
    if (folderName === "main" || folderName === "test") {
      this.addLog("Cannot delete default folders (main/test)", "error");
      return;
    }

    const modal = document.getElementById("deleteFolderModal");
    const folderNameEl = document.getElementById("deleteFolderName");

    if (modal && folderNameEl) {
      folderNameEl.textContent = displayName;
      modal.dataset.folderName = folderName;
      modal.classList.add("active");
    }
  }

  hideDeleteFolderModal() {
    const modal = document.getElementById("deleteFolderModal");
    if (modal) {
      modal.classList.remove("active");
      delete modal.dataset.folderName;
    }
  }

  validateFolderForm() {
    const nameInput = document.getElementById("newFolderName");
    const confirmBtn = document.getElementById("confirmCreateFolder");

    if (nameInput && confirmBtn) {
      const name = nameInput.value.trim();
      const isValid =
        name.length >= 1 &&
        name.length <= 50 &&
        /^[a-zA-Z0-9_-]+$/.test(name) &&
        !this.folders.some((f) => f.name === name.toLowerCase());

      confirmBtn.disabled = !isValid;

      // Show validation feedback
      nameInput.style.borderColor =
        name.length > 0 ? (isValid ? "#22c55e" : "#ef4444") : "#e1e5e9";
    }
  }

  async createFolder() {
    const nameInput = document.getElementById("newFolderName");
    const displayNameInput = document.getElementById("newFolderDisplayName");

    const name = nameInput.value.trim();
    const displayName = displayNameInput.value.trim() || name;

    try {
      this.addLog(`📁 Creating folder: ${name}`, "info");

      const response = await fetch(`${this.apiBaseUrl}/api/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, displayName }),
      });

      const result = await response.json();

      if (result.success) {
        this.addLog(
          `✅ Folder '${result.data.folder.displayName}' created successfully`,
          "success"
        );
        this.hideCreateFolderModal();
        await this.loadFolders(); // Refresh the folders list

        // Automatically select the newly created folder
        // Use the actual folder name returned by the backend (which may be sanitized)
        await this.selectFolder(result.data.folder.name);
      } else {
        this.addLog(`Failed to create folder: ${result.error}`, "error");
      }
    } catch (error) {
      this.addLog(`Error creating folder: ${error.message}`, "error");
    }
  }

  async confirmDeleteFolder() {
    const modal = document.getElementById("deleteFolderModal");
    const folderName = modal.dataset.folderName;

    if (!folderName) return;

    try {
      this.addLog(`🗑️ Deleting folder: ${folderName}`, "info");

      const response = await fetch(
        `${this.apiBaseUrl}/api/folders/${folderName}`,
        {
          method: "DELETE",
        }
      );

      const result = await response.json();

      if (result.success) {
        this.addLog(
          `✅ Folder '${folderName}' deleted successfully`,
          "success"
        );
        this.hideDeleteFolderModal();
        await this.loadFolders(); // Refresh the folders list
      } else {
        this.addLog(`Failed to delete folder: ${result.error}`, "error");
      }
    } catch (error) {
      this.addLog(`Error deleting folder: ${error.message}`, "error");
    }
  }

  // =====================================================
  // EXISTING RESUME PROCESSING METHODS (Updated)
  // =====================================================

  handleDragOver(e) {
    e.preventDefault();
    document.getElementById("fileUploadArea").classList.add("dragover");
  }

  handleDragLeave(e) {
    e.preventDefault();
    document.getElementById("fileUploadArea").classList.remove("dragover");
  }

  handleDrop(e) {
    e.preventDefault();
    document.getElementById("fileUploadArea").classList.remove("dragover");
    const files = Array.from(e.dataTransfer.files).filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
    );
    this.updateFiles(files);
  }

  handleFileSelect(e) {
    const files = Array.from(e.target.files);
    this.updateFiles(files);
  }

  updateFiles(files) {
    this.files = files;
    this.displayFileList();
    this.updateStepStatus();

    if (files.length > 0) {
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      this.addLog(
        `Selected ${files.length} PDF files (${this.formatFileSize(
          totalSize
        )} total) for folder '${this.currentFolder}'`,
        "info"
      );

      if (files.length > 1000) {
        this.addLog(
          `Large batch detected (${files.length} files) - processing will be optimized`,
          "warning"
        );
      }
    }
  }

  async convertToJson() {
    if (this.files.length === 0) {
      this.addLog("No files selected for conversion", "error");
      return;
    }

    if (!this.currentFolder) {
      this.addLog("No folder selected. Please select a folder first.", "error");
      return;
    }

    try {
      const formData = new FormData();
      this.files.forEach((file) => {
        formData.append("resumes", file);
      });

      this.addLog(
        `🔄 Converting ${this.files.length} resumes to JSON in folder '${this.currentFolder}' using LlamaIndex...`,
        "info"
      );

      const convertBtn = document.getElementById("convertToJson");
      convertBtn.disabled = true;
      convertBtn.innerHTML = "<span>🔄</span> Converting...";

      const response = await fetch(`${this.apiBaseUrl}/api/extract`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        this.currentBatchId = result.data.batchId;
        this.extracted = true;

        this.addLog(
          `✅ Successfully extracted ${result.data.extractedCount} resumes to folder '${result.data.folder}'`,
          "success"
        );

        this.updateStepStatus();
        await this.loadFolders(); // Refresh folder stats
      } else {
        this.addLog(`Extraction failed: ${result.error}`, "error");
      }
    } catch (error) {
      this.addLog(`Extraction error: ${error.message}`, "error");
    } finally {
      const convertBtn = document.getElementById("convertToJson");
      convertBtn.disabled = false;
      convertBtn.innerHTML = "<span>🔄</span> Convert to JSON";
    }
  }

  async detectExtractedFiles() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/extracted-files`);
      const result = await response.json();

      if (result.success && result.data.files.length > 0) {
        this.extracted = true;
        this.showDetectedFiles(result.data.files);
        this.showReadyToStart(result.data.files.length);
        this.addLog(
          `📋 Found ${result.data.files.length} extracted files in folder '${result.data.folder}'`,
          "info"
        );
      } else {
        this.addLog(
          `⚠️ No extracted JSON files found in current folder '${this.currentFolder}'. Please complete Step 1 first.`,
          "warning"
        );
      }
    } catch (error) {
      this.addLog(`Error detecting files: ${error.message}`, "error");
    }
  }

  displayFileList() {
    const fileList = document.getElementById("fileList");

    if (this.files.length === 0) {
      fileList.classList.add("hidden");
      return;
    }

    fileList.classList.remove("hidden");

    if (this.files.length > 20) {
      const totalSize = this.files.reduce((sum, file) => sum + file.size, 0);
      fileList.innerHTML = `
            <div class="file-item">
              <span class="file-name">📊 ${
                this.files.length
              } PDF files selected</span>
              <span class="file-size">${this.formatFileSize(totalSize)}</span>
            </div>
          `;
    } else {
      fileList.innerHTML = this.files
        .map(
          (file) => `
              <div class="file-item">
                <span class="file-name">${file.name}</span>
                <span class="file-size">${this.formatFileSize(file.size)}</span>
              </div>
            `
        )
        .join("");
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  updateStepStatus() {
    // Update button states and UI based on current progress
    const convertBtn = document.getElementById("convertToJson");
    const saveConfigBtn = document.getElementById("saveConfig");
    const startEvalBtn = document.getElementById("startEvaluation");
    const downloadExtractionsBtn = document.getElementById(
      "downloadExtractionsAlways"
    );

    if (convertBtn) {
      convertBtn.disabled = this.files.length === 0 || !this.currentFolder;
    }

    // Use the new validation method for config button
    if (saveConfigBtn) {
      this.validateAndUpdateConfigButton();
    }

    if (downloadExtractionsBtn) {
      downloadExtractionsBtn.disabled = !this.extracted;
    }

    const hasExtracted =
      this.extracted ||
      (document.getElementById("detectedCount") &&
        document.getElementById("detectedCount").textContent > "0");

    if (startEvalBtn) {
      startEvalBtn.disabled = !(hasExtracted && this.configured);
    }
  }

  validateConfiguration() {
    const jobDescElement = document.getElementById("jobDescription");
    const rubricElement = document.getElementById("evaluationRubric");

    if (!jobDescElement || !rubricElement) {
      console.log("❌ Configuration elements not found");
      return false;
    }

    const jobDesc = jobDescElement.value.trim();
    const rubric = rubricElement.value.trim();

    const isValid = jobDesc.length >= 10 && rubric.length >= 20;

    console.log(`🔧 Validation check:`, {
      jobDescLength: jobDesc.length,
      rubricLength: rubric.length,
      isValid: isValid,
    });

    return isValid;
  }

  // Add this new method to properly update the button state
  validateAndUpdateConfigButton() {
    const saveConfigBtn = document.getElementById("saveConfig");
    if (saveConfigBtn) {
      const isValid = this.validateConfiguration();
      saveConfigBtn.disabled = !isValid;

      // Visual feedback
      if (isValid) {
        saveConfigBtn.style.opacity = "1";
        saveConfigBtn.style.cursor = "pointer";
        console.log("✅ Configuration is valid - button enabled");
      } else {
        saveConfigBtn.style.opacity = "0.6";
        saveConfigBtn.style.cursor = "not-allowed";
        console.log("❌ Configuration invalid - button disabled");
      }
    }
  }

  async saveConfiguration() {
    if (!this.validateConfiguration()) {
      this.addLog(
        "Job description and rubric must be at least 20 characters each",
        "error"
      );
      return;
    }

    const jobDescription = document
      .getElementById("jobDescription")
      .value.trim();
    const evaluationRubric = document
      .getElementById("evaluationRubric")
      .value.trim();

    // Get Google Sheets configuration with 3 tab names
    const googleSheetId = document
      .getElementById("googleSheetId")
      ?.value.trim();
    const openaiTabName =
      document.getElementById("openaiTabName")?.value.trim() || "OpenAI_Results";
    const claudeTabName =
      document.getElementById("claudeTabName")?.value.trim() || "Claude_Results";
    const geminiTabName =
      document.getElementById("geminiTabName")?.value.trim() || "Gemini_Results";

    const configData = {
      jobDescription,
      evaluationRubric,
      googleSheets: googleSheetId
        ? {
            sheetId: googleSheetId,
            openaiTabName: openaiTabName,
            claudeTabName: claudeTabName,
            geminiTabName: geminiTabName,
          }
        : null,
    };

    try {
      this.addLog("💾 Saving job configuration...", "info");

      if (googleSheetId) {
        this.addLog(
          `📊 Including Google Sheets logging: ${googleSheetId} (Tab: ${sheetTabName})`,
          "info"
        );
      }

      const response = await fetch(`${this.apiBaseUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configData),
      });

      const result = await response.json();

      if (result.success) {
        this.configured = true;
        let successMessage = "✅ Configuration saved successfully";
        if (result.data.googleSheets) {
          successMessage += ` (Google Sheets: ${result.data.googleSheets.sheetId})`;
        }
        this.addLog(successMessage, "success");
        await this.detectExtractedFiles();
        this.updateStepStatus();
      } else {
        this.addLog(`Configuration error: ${result.error}`, "error");
      }
    } catch (error) {
      this.addLog(`Configuration save error: ${error.message}`, "error");
    }
  }

  showDetectedFiles(files) {
    const detectedDiv = document.getElementById("detectedFiles");
    const filesList = document.getElementById("detectedFilesList");

    if (detectedDiv) detectedDiv.classList.remove("hidden");
    if (document.getElementById("detectedCount")) {
      document.getElementById("detectedCount").textContent = files.length;
    }

    if (filesList) {
      const displayFiles = files.slice(0, 10);
      filesList.innerHTML = displayFiles
        .map(
          (file) => `
            <div class="detected-item" style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
              <span style="font-weight: 500;">${file.name}</span>
              <span style="color: #666; font-size: 0.85rem;">${this.formatFileSize(
                file.size
              )}</span>
            </div>
          `
        )
        .join("");

      if (files.length > 10) {
        filesList.innerHTML += `
              <div class="detected-item" style="display: flex; justify-content: space-between; padding: 8px 0;">
                <span>... and ${files.length - 10} more files</span>
                <span style="color: #666; font-size: 0.85rem;">Ready for evaluation</span>
              </div>
            `;
      }
    }
  }

  showReadyToStart(fileCount) {
    const readyDiv = document.getElementById("readyToStart");
    if (readyDiv) readyDiv.classList.remove("hidden");

    if (document.getElementById("readyExtracted")) {
      document.getElementById("readyExtracted").textContent = fileCount;
    }
    if (document.getElementById("readyConfig")) {
      document.getElementById("readyConfig").textContent = this.configured
        ? "Configured ✅"
        : "Not set";
    }
    if (document.getElementById("readyToEvaluate")) {
      document.getElementById("readyToEvaluate").textContent = fileCount;
    }

    document.getElementById("startEvaluation").disabled = !(
      fileCount > 0 && this.configured
    );
  }

  async startEvaluation() {
    try {
      this.addLog(
        `🚀 Preparing AI evaluation in folder '${this.currentFolder}'...`,
        "info"
      );

      // Show Step 4 with model configuration
      const step4 = document.getElementById("step4");
      if (step4) {
        step4.classList.remove("status-pending");
        step4.classList.add("status-active");
      }

      // Enable the model configuration section
      const modelConfigSection = document.getElementById("modelConfigSection");
      if (modelConfigSection) {
        modelConfigSection.style.display = "block";
      }

      this.addLog(
        `✅ Ready for AI scoring - Configure models and click 'Start Multi-Model Scoring'`,
        "success"
      );

    } catch (error) {
      this.addLog(`Evaluation preparation error: ${error.message}`, "error");
    }
  }

  async startMultiModelScoring() {
    try {
      // Get model names from inputs
      const openaiModel = document.getElementById("openaiModel")?.value.trim() || "gpt-4o-mini";
      const claudeModel = document.getElementById("claudeModel")?.value.trim() || "claude-3-5-sonnet-20240620";
      const geminiModel = document.getElementById("geminiModel")?.value.trim() || "gemini-pro";

      this.addLog(
        `🚀 Starting parallel AI scoring with 3 models in folder '${this.currentFolder}'...`,
        "info"
      );
      this.addLog(`🤖 OpenAI: ${openaiModel}`, "info");
      this.addLog(`🧠 Claude: ${claudeModel}`, "info");
      this.addLog(`✨ Gemini: ${geminiModel}`, "info");

      // Hide model config section and show progress bars
      const modelConfigSection = document.getElementById("modelConfigSection");
      if (modelConfigSection) {
        modelConfigSection.style.display = "none";
      }

      // Start parallel scoring for all 3 models
      const response = await fetch(`${this.apiBaseUrl}/api/start-multi-model-scoring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: {
            openai: openaiModel,
            claude: claudeModel,
            gemini: geminiModel
          }
        }),
      });

      const result = await response.json();

      if (result.success) {
        this.currentBatchId = result.data.batchId;
        this.addLog(
          `✅ Multi-model scoring started - Batch ID: ${this.currentBatchId}`,
          "success"
        );

        // Show all progress bars
        document.getElementById("openaiScoringProgress")?.classList.remove("hidden");
        document.getElementById("claudeScoringProgress")?.classList.remove("hidden");
        document.getElementById("geminiScoringProgress")?.classList.remove("hidden");

        // Start monitoring all 3 models
        this.startMultiModelMonitoring();
        this.updateStepStatus();
      } else {
        this.addLog(`Multi-model scoring start failed: ${result.error}`, "error");
      }
    } catch (error) {
      this.addLog(`Multi-model scoring start error: ${error.message}`, "error");
    }
  }

  async startAnthropicValidation() {
    try {
      if (!this.currentBatchId) {
        this.addLog(
          "No batch ID available. Please complete OpenAI scoring first.",
          "error"
        );
        return;
      }

      this.addLog("🔍 Starting Anthropic validation...", "info");

      const response = await fetch(
        `${this.apiBaseUrl}/api/start-anthropic-validation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: this.currentBatchId }),
        }
      );

      const result = await response.json();

      if (result.success) {
        this.addLog(
          `✅ Anthropic validation started for batch ${this.currentBatchId}`,
          "success"
        );

        document.getElementById("startAnthropicValidation").style.display =
          "none";
        document
          .getElementById("anthropicValidationSection")
          .classList.remove("hidden");

        this.startValidationMonitoring();
      } else {
        this.addLog(
          `Anthropic validation start failed: ${result.error}`,
          "error"
        );
      }
    } catch (error) {
      this.addLog(
        `Anthropic validation start error: ${error.message}`,
        "error"
      );
    }
  }

  startMultiModelMonitoring() {
    this.progressInterval = setInterval(async () => {
      await this.updateMultiModelProgress();
    }, 3000);
  }

  stopMultiModelMonitoring() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  startScoringMonitoring() {
    const scoringProgress = document.getElementById("scoringProgress");
    if (scoringProgress) scoringProgress.classList.remove("hidden");

    this.progressInterval = setInterval(async () => {
      await this.updateScoringProgress();
    }, 3000);
  }

  startValidationMonitoring() {
    this.validationInterval = setInterval(async () => {
      await this.updateValidationProgress();
    }, 3000);
  }

  async updateScoringProgress() {
    try {
      if (!this.currentBatchId) return;

      const response = await fetch(
        `${this.apiBaseUrl}/api/batch/${this.currentBatchId}/progress`
      );
      const result = await response.json();

      if (result.success) {
        const metrics = result.data.metrics;
        this.updateScoringProgressDisplay(metrics);

        if (result.data.status === "scored") {
          this.handleScoringComplete(metrics);
        }
      }
    } catch (error) {
      console.warn("Error updating scoring progress:", error);
    }
  }

  async updateValidationProgress() {
    try {
      if (!this.currentBatchId) return;

      const response = await fetch(
        `${this.apiBaseUrl}/api/batch/${this.currentBatchId}/progress`
      );
      const result = await response.json();

      if (result.success) {
        const metrics = result.data.metrics;
        this.updateValidationProgressDisplay(metrics);

        if (result.data.status === "completed") {
          this.handleValidationComplete(metrics);
        }
      }
    } catch (error) {
      console.warn("Error updating validation progress:", error);
    }
  }

  updateScoringProgressDisplay(metrics) {
    const scored = metrics.scored || 0;
    const total = metrics.total || 0;

    const elements = {
      scoredCount: document.getElementById("scoredCount"),
      totalToScore: document.getElementById("totalToScore"),
      scoringProgressFill: document.getElementById("scoringProgressFill"),
    };

    if (elements.scoredCount) elements.scoredCount.textContent = scored;
    if (elements.totalToScore) elements.totalToScore.textContent = total;

    const percentage = total > 0 ? (scored / total) * 100 : 0;
    if (elements.scoringProgressFill) {
      elements.scoringProgressFill.style.width = percentage + "%";
    }
  }

  updateValidationProgressDisplay(metrics) {
    const validated = metrics.completed || 0;
    const total = metrics.total || 0;

    const elements = {
      validatedCount: document.getElementById("validatedCount"),
      totalToValidate: document.getElementById("totalToValidate"),
      validationProgressFill: document.getElementById("validationProgressFill"),
    };

    if (elements.validatedCount)
      elements.validatedCount.textContent = validated;
    if (elements.totalToValidate) elements.totalToValidate.textContent = total;

    const percentage = total > 0 ? (validated / total) * 100 : 0;
    if (elements.validationProgressFill) {
      elements.validationProgressFill.style.width = percentage + "%";
    }
  }

  async updateMultiModelProgress() {
    try {
      if (!this.currentBatchId) return;

      const response = await fetch(
        `${this.apiBaseUrl}/api/batch/${this.currentBatchId}/multi-model-progress`
      );
      const result = await response.json();

      if (result.success) {
        const progress = result.data;
        
        // Update OpenAI progress
        if (progress.openai) {
          this.updateModelProgressDisplay('openai', progress.openai);
        }
        
        // Update Claude progress
        if (progress.claude) {
          this.updateModelProgressDisplay('claude', progress.claude);
        }
        
        // Update Gemini progress
        if (progress.gemini) {
          this.updateModelProgressDisplay('gemini', progress.gemini);
        }

        // Check if all models are complete
        const allComplete = 
          progress.openai?.status === 'completed' &&
          progress.claude?.status === 'completed' &&
          progress.gemini?.status === 'completed';

        if (allComplete) {
          this.handleMultiModelComplete(progress);
        }
      }
    } catch (error) {
      console.warn("Error updating multi-model progress:", error);
    }
  }

  updateModelProgressDisplay(modelName, metrics) {
    const scored = metrics.scored || 0;
    const total = metrics.total || 0;

    const scoredCountEl = document.getElementById(`${modelName}ScoredCount`);
    const totalToScoreEl = document.getElementById(`${modelName}TotalToScore`);
    const progressFillEl = document.getElementById(`${modelName}ProgressFill`);

    if (scoredCountEl) scoredCountEl.textContent = scored;
    if (totalToScoreEl) totalToScoreEl.textContent = total;

    const percentage = total > 0 ? (scored / total) * 100 : 0;
    if (progressFillEl) {
      progressFillEl.style.width = percentage + "%";
    }
  }

  handleMultiModelComplete(progress) {
    this.stopMultiModelMonitoring();

    const openaiScored = progress.openai?.scored || 0;
    const claudeScored = progress.claude?.scored || 0;
    const geminiScored = progress.gemini?.scored || 0;

    this.addLog(
      `🎉 All AI model scoring completed!`,
      "success"
    );
    this.addLog(`🤖 OpenAI: ${openaiScored} files scored`, "success");
    this.addLog(`🧠 Claude: ${claudeScored} files scored`, "success");
    this.addLog(`✨ Gemini: ${geminiScored} files scored`, "success");

    // Hide progress bars
    document.getElementById("openaiScoringProgress")?.classList.add("hidden");
    document.getElementById("claudeScoringProgress")?.classList.add("hidden");
    document.getElementById("geminiScoringProgress")?.classList.add("hidden");

    // Show completion section
    const allScoringComplete = document.getElementById("allScoringComplete");
    if (allScoringComplete) {
      allScoringComplete.classList.remove("hidden");
      
      // Update summary counts
      document.getElementById("openaiCompleteSummary").textContent = `${openaiScored} files`;
      document.getElementById("claudeCompleteSummary").textContent = `${claudeScored} files`;
      document.getElementById("geminiCompleteSummary").textContent = `${geminiScored} files`;
    }
  }

  handleScoringComplete(metrics) {
    this.stopScoringMonitoring();

    const scored = metrics.scored || 0;
    const total = metrics.total || 0;
    const successRate = ((scored / total) * 100).toFixed(1);

    this.addLog(
      `🎉 OpenAI scoring completed! ${scored}/${total} files scored (${successRate}%)`,
      "success"
    );

    const scoringProgress = document.getElementById("scoringProgress");
    const scoringComplete = document.getElementById("scoringComplete");
    const scoringSummary = document.getElementById("scoringSummary");

    if (scoringProgress) scoringProgress.classList.add("hidden");
    if (scoringComplete) scoringComplete.classList.remove("hidden");
    if (scoringSummary)
      scoringSummary.textContent = `${scored} files scored successfully`;

    // Refresh folder stats
    this.loadFolders();
  }

  handleValidationComplete(metrics) {
    this.stopValidationMonitoring();

    const validated = metrics.completed || 0;
    const total = metrics.total || 0;
    const successRate = ((validated / total) * 100).toFixed(1);

    this.addLog(
      `🎉 Anthropic validation completed! ${validated}/${total} files validated (${successRate}%)`,
      "success"
    );

    const validationSection = document.getElementById(
      "anthropicValidationSection"
    );
    const validationComplete = document.getElementById(
      "anthropicValidationComplete"
    );
    const validationSummary = document.getElementById(
      "anthropicValidationSummary"
    );

    if (validationSection) validationSection.classList.add("hidden");
    if (validationComplete) validationComplete.classList.remove("hidden");
    if (validationSummary)
      validationSummary.textContent = `${validated} files validated successfully`;

    // Refresh folder stats
    this.loadFolders();
  }

  stopScoringMonitoring() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  stopValidationMonitoring() {
    if (this.validationInterval) {
      clearInterval(this.validationInterval);
      this.validationInterval = null;
    }
  }

  async downloadAllScores() {
    if (!this.currentBatchId) {
      this.addLog("No batch available for download", "error");
      return;
    }

    try {
      this.addLog(
        `📥 Downloading all AI model scores from folder '${this.currentFolder}'...`,
        "info"
      );

      const response = await fetch(
        `${this.apiBaseUrl}/api/batch/${this.currentBatchId}/download/all-scores`
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;

        link.download = `${this.currentFolder}-all-ai-scores-${this.currentBatchId}.zip`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        this.addLog(`✅ All AI model scores downloaded successfully`, "success");
      } else {
        const error = await response.text();
        this.addLog(`Download failed: ${error}`, "error");
      }
    } catch (error) {
      this.addLog(`Download error: ${error.message}`, "error");
    }
  }

  async downloadResults(type) {
    if (!this.currentBatchId) {
      this.addLog("No batch available for download", "error");
      return;
    }

    try {
      this.addLog(
        `📥 Downloading ${type} from folder '${this.currentFolder}'...`,
        "info"
      );

      const response = await fetch(
        `${this.apiBaseUrl}/api/batch/${this.currentBatchId}/download/${type}`
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;

        const extension = type === "report" ? "json" : "zip";
        link.download = `${this.currentFolder}-${type}-${this.currentBatchId}.${extension}`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        this.addLog(`✅ ${type} downloaded successfully`, "success");
      } else {
        const error = await response.json();
        this.addLog(`Download failed: ${error.error}`, "error");
      }
    } catch (error) {
      this.addLog(`Download error: ${error.message}`, "error");
    }
  }

  addLog(message, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement("div");
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;

    const statusLog = document.getElementById("statusLog");
    if (statusLog) {
      statusLog.appendChild(logEntry);
      statusLog.scrollTop = statusLog.scrollHeight;

      // Keep only last 100 entries
      const entries = statusLog.querySelectorAll(".log-entry");
      if (entries.length > 100) {
        entries[0].remove();
      }
    }

    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

// Initialize the application when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  window.processor = new EnhancedResumeProcessor();
});
