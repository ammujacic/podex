# Podex Workspace Base Image
# This image provides a secure, feature-rich development environment for user workspaces.
# Designed to run with gVisor (runsc) for enhanced security in production.

FROM ubuntu:24.04

LABEL maintainer="Podex <support@podex.dev>"
LABEL description="Podex workspace base image with development tools"
LABEL version="1.0.0"

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Create non-root user for workspace operations
ARG WORKSPACE_USER=podex
ARG WORKSPACE_UID=1000
ARG WORKSPACE_GID=1000

RUN groupadd --gid ${WORKSPACE_GID} ${WORKSPACE_USER} \
    && useradd --uid ${WORKSPACE_UID} --gid ${WORKSPACE_GID} -m -s /bin/zsh ${WORKSPACE_USER}

# Install base system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Essential tools
    ca-certificates \
    curl \
    wget \
    gnupg \
    lsb-release \
    software-properties-common \
    apt-transport-https \
    # Development essentials
    build-essential \
    git \
    git-lfs \
    openssh-client \
    # Shell and terminal
    zsh \
    tmux \
    vim \
    nano \
    less \
    # System utilities
    htop \
    procps \
    net-tools \
    iputils-ping \
    dnsutils \
    iproute2 \
    # File utilities
    zip \
    unzip \
    tar \
    gzip \
    bzip2 \
    xz-utils \
    # Text processing
    jq \
    yq \
    ripgrep \
    fd-find \
    fzf \
    # Database clients
    postgresql-client \
    redis-tools \
    # Python build dependencies
    python3-dev \
    python3-pip \
    python3-venv \
    # Other useful tools
    sudo \
    locales \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Generate locale
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

# Install Node.js (LTS)
ARG NODE_VERSION=20
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g npm@latest

# Install global Node.js tools
RUN npm install -g \
    typescript \
    ts-node \
    pnpm \
    yarn \
    prettier \
    eslint

# Install Python tools
RUN pip3 install --no-cache-dir --break-system-packages \
    pipx \
    poetry \
    black \
    ruff \
    mypy \
    pytest \
    httpie

# Install Rust (for user, not system-wide)
ENV RUSTUP_HOME=/opt/rust/rustup
ENV CARGO_HOME=/opt/rust/cargo
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path \
    && chmod -R a+rw /opt/rust
ENV PATH="/opt/rust/cargo/bin:${PATH}"

# Install Go
ARG GO_VERSION=1.22.0
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/home/${WORKSPACE_USER}/go"
ENV PATH="${GOPATH}/bin:${PATH}"

# Install Docker CLI (for docker-in-docker scenarios if needed)
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Oh My Zsh for better shell experience
USER ${WORKSPACE_USER}
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# Configure Zsh
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/${WORKSPACE_USER}/.zshrc \
    && echo 'export EDITOR=vim' >> /home/${WORKSPACE_USER}/.zshrc \
    && echo 'export VISUAL=vim' >> /home/${WORKSPACE_USER}/.zshrc

# Create workspace directories
RUN mkdir -p /home/${WORKSPACE_USER}/projects \
    && mkdir -p /home/${WORKSPACE_USER}/.config \
    && mkdir -p /home/${WORKSPACE_USER}/.local/bin \
    && mkdir -p /home/${WORKSPACE_USER}/.cache

# Set up Git defaults
RUN git config --global init.defaultBranch main \
    && git config --global core.editor vim \
    && git config --global pull.rebase false

USER root

# Allow workspace user to use sudo without password (for development convenience)
RUN echo "${WORKSPACE_USER} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/${WORKSPACE_USER}

# Create standard workspace mount points
RUN mkdir -p /workspace/projects \
    && mkdir -p /workspace/.config \
    && chown -R ${WORKSPACE_USER}:${WORKSPACE_USER} /workspace

# Health check script
COPY --chmod=755 healthcheck.sh /usr/local/bin/healthcheck.sh

# Entrypoint script for workspace initialization
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

# Set working directory
WORKDIR /workspace/projects

# Switch to workspace user
USER ${WORKSPACE_USER}

# Default command - keep container running
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sleep", "infinity"]

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh
