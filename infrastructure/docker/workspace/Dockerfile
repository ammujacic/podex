# Podex Workspace Base Image
# This image provides a consistent development environment for all workspaces
# with common tools, shells, and AI coding agents pre-installed.

FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install essential packages including zsh
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Shells
    bash \
    zsh \
    fish \
    # Core utilities
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    lsb-release \
    sudo \
    software-properties-common \
    # Build essentials
    build-essential \
    pkg-config \
    # Python (system)
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    # Editors
    vim \
    nano \
    # Networking tools
    openssh-client \
    netcat-openbsd \
    iputils-ping \
    dnsutils \
    # Process management
    tmux \
    screen \
    htop \
    # File utilities
    tree \
    jq \
    unzip \
    zip \
    # Timezone data
    tzdata \
    # Locales
    locales \
    && rm -rf /var/lib/apt/lists/*

# Set up locales
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

# Install Node.js 20.x (required for modern npm packages)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (required for GitHub Copilot CLI)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user 'dev' with sudo access
RUN useradd -m -s /bin/zsh -G sudo dev \
    && echo "dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/dev \
    && chmod 0440 /etc/sudoers.d/dev

# Set up zsh with a basic config for the dev user
USER dev
WORKDIR /home/dev

# Install oh-my-zsh for a better shell experience
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# Create common directories
RUN mkdir -p ~/.local/bin ~/.config ~/.npm-global ~/.config/fish

# Configure PATH for all shells (zsh, bash, fish)
# Using .profile for login shells, .bashrc for interactive bash, .zshrc for zsh, fish config for fish
RUN AGENT_PATH='export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"' \
    && echo "$AGENT_PATH" >> ~/.profile \
    && echo "$AGENT_PATH" >> ~/.bashrc \
    && echo "$AGENT_PATH" >> ~/.zshrc \
    && echo 'set -gx PATH $HOME/.local/bin $HOME/.npm-global/bin $PATH' >> ~/.config/fish/config.fish

# Configure npm to use user directory for global packages
RUN npm config set prefix ~/.npm-global

# ============================================================
# Install Terminal CLI Agents
# ============================================================

# Upgrade pip and install build tools first (fixes setuptools.command.bdist_wheel error)
RUN pip install --user --upgrade pip setuptools wheel

# Install npm-based agents (Claude Code, OpenAI Codex, Gemini CLI)
# Note: Some packages may not exist yet, using || true for optional ones
RUN npm install -g @anthropic-ai/claude-code || true
RUN npm install -g @openai/codex || true
RUN npm install -g @google/gemini-cli || true

# Install pip-based agents that are known to work
# Each in separate RUN to avoid one failure breaking all
RUN pip install --user --no-cache-dir aider-chat || true
RUN pip install --user --no-cache-dir open-interpreter || true
RUN pip install --user --no-cache-dir mentat-ai || true

# Install OpenCode (curl-based installer)
RUN curl -fsSL https://opencode.ai/install | bash || true

# Install Plandex (curl-based installer)
RUN curl -sL https://plandex.ai/install.sh | bash || true

# Install Tabby (curl-based installer)
RUN curl -fsSL https://tabby.tabbyml.com/install.sh | bash || true

# Install GitHub Copilot CLI extension (requires gh to be authenticated at runtime)
# Note: This will be installed but requires `gh auth login` before use
RUN gh extension install github/gh-copilot || true

# Set zsh as default shell
ENV SHELL=/bin/zsh

# Add npm global bin and local bin to PATH
ENV PATH="/home/dev/.npm-global/bin:/home/dev/.local/bin:${PATH}"

# Create projects directory with proper ownership (WORKDIR creates as root)
RUN mkdir -p /home/dev/projects

# Copy and set up workspace entrypoint script
# This script handles GCS mount setup, dotfile symlinks, and git config
COPY workspace-entrypoint.sh /usr/local/bin/workspace-entrypoint.sh
USER root
RUN chmod +x /usr/local/bin/workspace-entrypoint.sh
USER dev

# Default working directory for projects
WORKDIR /home/dev/projects

# Entrypoint handles workspace initialization
ENTRYPOINT ["/usr/local/bin/workspace-entrypoint.sh"]

# Default command (can be overridden)
CMD ["/bin/zsh"]
