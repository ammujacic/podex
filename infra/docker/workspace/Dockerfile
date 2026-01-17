# Podex Workspace Image
# Ubuntu-based development environment with common tools pre-installed
FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Create dev user with sudo access
RUN useradd -m -s /bin/bash -u 1000 dev && \
    mkdir -p /home/dev && \
    chown -R dev:dev /home/dev && \
    echo "dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Install base dependencies and add deadsnakes PPA for Python 3.12
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Essential tools
    curl \
    wget \
    git \
    vim \
    nano \
    htop \
    tree \
    jq \
    unzip \
    zip \
    sudo \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common \
    # Terminal multiplexer for session persistence
    tmux \
    # Alternative shells
    zsh \
    fish \
    # Build essentials
    build-essential \
    pkg-config \
    libssl-dev \
    libffi-dev \
    # Database clients
    postgresql-client \
    redis-tools \
    # Network tools
    iputils-ping \
    net-tools \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Add deadsnakes PPA and install Python 3.12
RUN add-apt-repository ppa:deadsnakes/ppa && \
    apt-get update && apt-get install -y --no-install-recommends \
    python3.12 \
    python3.12-venv \
    python3.12-dev \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.12 as default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.12 1 && \
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@latest

# Install pip for Python 3.12 and uv (fast Python package manager)
RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3.12 && \
    pip3 install uv

# Install Rust (for projects that need it)
ENV RUSTUP_HOME=/opt/rust/rustup
ENV CARGO_HOME=/opt/rust/cargo
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal && \
    chmod -R 777 /opt/rust

# Add Rust to PATH
ENV PATH="/opt/rust/cargo/bin:${PATH}"

# Install Go 1.22 (architecture-aware)
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://go.dev/dl/go1.22.0.linux-${ARCH}.tar.gz" | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/home/dev/go"

# Install common global tools
RUN npm install -g \
    typescript \
    ts-node \
    tsx \
    eslint \
    prettier \
    turbo \
    vercel

# Install Python tools
RUN pip3 install \
    poetry \
    black \
    ruff \
    mypy \
    pytest \
    httpie

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Configure git defaults
RUN git config --system init.defaultBranch main && \
    git config --system core.editor vim && \
    git config --system pull.rebase false

# Set up workspace directory
WORKDIR /home/dev
USER dev

# Create common directories
RUN mkdir -p /home/dev/.cache /home/dev/.local /home/dev/projects

# Configure npm to use user-local directory for global packages (avoids permission issues)
RUN mkdir -p /home/dev/.npm-global && \
    npm config set prefix '/home/dev/.npm-global'

# Set environment variables
ENV HOME=/home/dev
ENV USER=dev
ENV SHELL=/bin/bash
ENV TERM=xterm-256color
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PATH="/home/dev/.npm-global/bin:${PATH}"

# Default shell configurations
RUN echo 'export PS1="\[\033[01;32m\]\u@podex\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "' >> ~/.bashrc && \
    echo 'export PATH="/home/dev/.npm-global/bin:$PATH"' >> ~/.bashrc && \
    echo 'alias ll="ls -la"' >> ~/.bashrc && \
    echo 'alias la="ls -A"' >> ~/.bashrc && \
    echo 'alias l="ls -CF"' >> ~/.bashrc

# Zsh configuration
RUN echo 'export PS1="%F{green}%n@podex%f:%F{blue}%~%f$ "' >> ~/.zshrc && \
    echo 'export PATH="/home/dev/.npm-global/bin:$PATH"' >> ~/.zshrc && \
    echo 'alias ll="ls -la"' >> ~/.zshrc && \
    echo 'alias la="ls -A"' >> ~/.zshrc && \
    echo 'alias l="ls -CF"' >> ~/.zshrc && \
    echo 'autoload -Uz compinit && compinit' >> ~/.zshrc

# Fish configuration
RUN mkdir -p ~/.config/fish && \
    echo 'set -gx PATH /home/dev/.npm-global/bin $PATH' >> ~/.config/fish/config.fish && \
    echo 'alias ll="ls -la"' >> ~/.config/fish/config.fish && \
    echo 'alias la="ls -A"' >> ~/.config/fish/config.fish && \
    echo 'alias l="ls -CF"' >> ~/.config/fish/config.fish && \
    echo 'function fish_prompt; set_color green; echo -n (whoami)"@podex"; set_color normal; echo -n ":"; set_color blue; echo -n (prompt_pwd); set_color normal; echo -n "\$ "; end' >> ~/.config/fish/config.fish

# Expose common development ports
EXPOSE 3000 3001 4000 5000 5173 8000 8080

# Keep container running
CMD ["sleep", "infinity"]
