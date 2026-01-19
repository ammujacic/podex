"""Default pod templates seed data."""

from typing import Any

OFFICIAL_TEMPLATES: list[dict[str, Any]] = [
    {
        "name": "Node.js",
        "slug": "nodejs",
        "description": "Node.js development environment with npm, yarn, and pnpm",
        "icon": "nodejs",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            # Install fnm (Fast Node Manager)
            "curl -fsSL https://fnm.vercel.app/install | bash",
            # Install Node.js 20 (call fnm directly by full path)
            "$HOME/.local/share/fnm/fnm install 20 && $HOME/.local/share/fnm/fnm default 20",
            # Install global npm packages (use fnm exec to run npm in the right context)
            "$HOME/.local/share/fnm/fnm exec npm install -g yarn pnpm",
        ],
        "environment_variables": {
            "NODE_ENV": "development",
            "PATH": "$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/share/fnm:$PATH",
        },
        "default_ports": [
            {"port": 3000, "label": "Dev Server", "protocol": "http"},
            {"port": 5173, "label": "Vite", "protocol": "http"},
        ],
        "language_versions": {"node": "20"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Python",
        "slug": "python",
        "description": "Python development with poetry, pip, and common tools",
        "icon": "python",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [],  # Workspace image has Python 3.12, poetry, etc. pre-installed
        "environment_variables": {
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        "default_ports": [
            {"port": 8000, "label": "FastAPI", "protocol": "http"},
            {"port": 5000, "label": "Flask", "protocol": "http"},
        ],
        "language_versions": {"python": "3.12"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Full Stack",
        "slug": "fullstack",
        "description": "Node.js + Python for full-stack development",
        "icon": "layers",
        "base_image": "podex/workspace:latest",
        # Workspace image has Node.js 20, Python 3.12, poetry, etc. pre-installed
        "pre_install_commands": [],
        "environment_variables": {
            "NODE_ENV": "development",
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        "default_ports": [
            {"port": 3000, "label": "Frontend", "protocol": "http"},
            {"port": 8000, "label": "Backend API", "protocol": "http"},
        ],
        "language_versions": {"node": "20", "python": "3.12"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Go",
        "slug": "golang",
        "description": "Go development environment",
        "icon": "go",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "wget https://go.dev/dl/go1.22.0.linux-amd64.tar.gz",
            "sudo tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz",
            "rm go1.22.0.linux-amd64.tar.gz",
        ],
        "environment_variables": {
            "GOPATH": "/home/dev/go",
            "PATH": "/usr/local/go/bin:/home/dev/go/bin:$PATH",
        },
        "default_ports": [{"port": 8080, "label": "Go Server", "protocol": "http"}],
        "language_versions": {"go": "1.22"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Rust",
        "slug": "rust",
        "description": "Rust development with cargo",
        "icon": "rust",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
        ],
        "environment_variables": {"PATH": "/home/dev/.cargo/bin:$PATH"},
        "default_ports": [{"port": 8080, "label": "Server", "protocol": "http"}],
        "language_versions": {"rust": "stable"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Blank",
        "slug": "blank",
        "description": "Minimal environment - start from scratch",
        "icon": "box",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [],
        "environment_variables": {},
        "default_ports": [{"port": 3000, "label": "Dev Server", "protocol": "http"}],
        "language_versions": {},
        "is_official": True,
        "is_public": True,
    },
    # ============ Web/Backend Frameworks ============
    {
        "name": "Next.js",
        "slug": "nextjs",
        "description": "Next.js 15 with App Router, TypeScript, and Tailwind CSS",
        "icon": "nextdotjs",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "curl -fsSL https://fnm.vercel.app/install | bash",
            "$HOME/.local/share/fnm/fnm install 20 && $HOME/.local/share/fnm/fnm default 20",
            "$HOME/.local/share/fnm/fnm exec npm install -g yarn pnpm",
        ],
        "environment_variables": {
            "NODE_ENV": "development",
            "PATH": "$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/share/fnm:$PATH",
        },
        "default_ports": [
            {"port": 3000, "label": "Next.js Dev", "protocol": "http"},
        ],
        "language_versions": {"node": "20"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Django",
        "slug": "django",
        "description": "Django 5.0 with PostgreSQL support and Django REST Framework",
        "icon": "django",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "pip install django djangorestframework psycopg2-binary django-cors-headers",
        ],
        "environment_variables": {
            # SECURITY: Debug mode disabled by default - users can enable if needed
            "DJANGO_DEBUG": "False",
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        "default_ports": [{"port": 8000, "label": "Django", "protocol": "http"}],
        "language_versions": {"python": "3.12"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "FastAPI",
        "slug": "fastapi",
        "description": "FastAPI with uvicorn, SQLAlchemy, and Pydantic",
        "icon": "fastapi",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "pip install fastapi uvicorn sqlalchemy asyncpg pydantic-settings",
        ],
        "environment_variables": {
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        "default_ports": [{"port": 8000, "label": "FastAPI", "protocol": "http"}],
        "language_versions": {"python": "3.12"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Ruby on Rails",
        "slug": "rails",
        "description": "Ruby on Rails 7 with Hotwire and Stimulus",
        "icon": "rubyonrails",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            (
                "gpg --keyserver keyserver.ubuntu.com --recv-keys "
                "409B6B1796C275462A1703113804BB82D39DC0E3 "
                "7D2BAF1CF37B13E2069D6956105BD0E739499BDB || true"
            ),
            "curl -sSL https://get.rvm.io | bash -s stable",
            "source ~/.rvm/scripts/rvm && rvm install 3.3.0 && rvm use 3.3.0 --default",
            "source ~/.rvm/scripts/rvm && gem install rails bundler",
        ],
        "environment_variables": {
            "RAILS_ENV": "development",
            "PATH": "$HOME/.rvm/gems/ruby-3.3.0/bin:$HOME/.rvm/rubies/ruby-3.3.0/bin:$PATH",
        },
        "default_ports": [{"port": 3000, "label": "Rails", "protocol": "http"}],
        "language_versions": {"ruby": "3.3"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Spring Boot",
        "slug": "spring",
        "description": "Spring Boot 3 with Gradle and Java 21",
        "icon": "springboot",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "curl -s https://get.sdkman.io | bash",
            "source $HOME/.sdkman/bin/sdkman-init.sh && sdk install java 21-tem",
            "source $HOME/.sdkman/bin/sdkman-init.sh && sdk install gradle",
        ],
        "environment_variables": {
            "JAVA_HOME": "$HOME/.sdkman/candidates/java/current",
            "PATH": (
                "$HOME/.sdkman/candidates/java/current/bin:"
                "$HOME/.sdkman/candidates/gradle/current/bin:$PATH"
            ),
        },
        "default_ports": [{"port": 8080, "label": "Spring Boot", "protocol": "http"}],
        "language_versions": {"java": "21"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Vue.js",
        "slug": "vuejs",
        "description": "Vue.js 3 with Vite, TypeScript, and Pinia",
        "icon": "vuedotjs",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "curl -fsSL https://fnm.vercel.app/install | bash",
            "$HOME/.local/share/fnm/fnm install 20 && $HOME/.local/share/fnm/fnm default 20",
            "$HOME/.local/share/fnm/fnm exec npm install -g yarn pnpm",
        ],
        "environment_variables": {
            "NODE_ENV": "development",
            "PATH": "$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/share/fnm:$PATH",
        },
        "default_ports": [{"port": 5173, "label": "Vite Dev", "protocol": "http"}],
        "language_versions": {"node": "20"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Laravel",
        "slug": "laravel",
        "description": "Laravel 11 with PHP 8.3 and Composer",
        "icon": "laravel",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            (
                "sudo apt-get update && sudo apt-get install -y php8.3 php8.3-cli "
                "php8.3-mbstring php8.3-xml php8.3-curl php8.3-zip unzip || true"
            ),
            (
                "curl -sS https://getcomposer.org/installer | php -- "
                "--install-dir=$HOME/.local/bin --filename=composer"
            ),
        ],
        "environment_variables": {
            "APP_ENV": "local",
            "PATH": "$HOME/.local/bin:$PATH",
        },
        "default_ports": [{"port": 8000, "label": "Laravel", "protocol": "http"}],
        "language_versions": {"php": "8.3"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Deno",
        "slug": "deno",
        "description": "Deno 2.0 with Fresh framework support",
        "icon": "deno",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "curl -fsSL https://deno.land/install.sh | sh",
        ],
        "environment_variables": {
            "DENO_INSTALL": "$HOME/.deno",
            "PATH": "$HOME/.deno/bin:$PATH",
        },
        "default_ports": [{"port": 8000, "label": "Deno", "protocol": "http"}],
        "language_versions": {"deno": "2.0"},
        "is_official": True,
        "is_public": True,
    },
    # ============ Native/Systems Templates ============
    {
        "name": "C/C++",
        "slug": "cpp",
        "description": "C/C++ development with GCC 13, CMake, and Conan package manager",
        "icon": "cplusplus",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            (
                "sudo apt-get update && sudo apt-get install -y "
                "build-essential cmake gdb valgrind clang-format"
            ),
            "pip install conan",
        ],
        "environment_variables": {
            "CC": "gcc",
            "CXX": "g++",
        },
        "default_ports": [{"port": 8080, "label": "Server", "protocol": "http"}],
        "language_versions": {"gcc": "13", "cmake": "3.28"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": ".NET",
        "slug": "dotnet",
        "description": ".NET 8 with C# 12 and ASP.NET Core",
        "icon": "dotnet",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh",
            "chmod +x dotnet-install.sh && ./dotnet-install.sh --channel 8.0",
            "rm dotnet-install.sh",
        ],
        "environment_variables": {
            "DOTNET_ROOT": "$HOME/.dotnet",
            "PATH": "$HOME/.dotnet:$HOME/.dotnet/tools:$PATH",
            "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
        },
        "default_ports": [{"port": 5000, "label": "ASP.NET", "protocol": "http"}],
        "language_versions": {"dotnet": "8.0"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "CUDA",
        "slug": "cuda",
        "description": "CUDA 12 development with cuDNN and PyTorch for GPU computing",
        "icon": "nvidia",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121",
            "pip install numpy scipy matplotlib jupyter",
        ],
        "environment_variables": {
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        "default_ports": [
            {"port": 8888, "label": "Jupyter", "protocol": "http"},
            {"port": 6006, "label": "TensorBoard", "protocol": "http"},
        ],
        "language_versions": {"python": "3.12", "cuda": "12.1"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Zig",
        "slug": "zig",
        "description": "Zig 0.13 systems programming language",
        "icon": "zig",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "wget https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz",
            "tar -xf zig-linux-x86_64-0.13.0.tar.xz",
            "sudo mv zig-linux-x86_64-0.13.0 /usr/local/zig",
            "rm zig-linux-x86_64-0.13.0.tar.xz",
        ],
        "environment_variables": {
            "PATH": "/usr/local/zig:$PATH",
        },
        "default_ports": [{"port": 8080, "label": "Server", "protocol": "http"}],
        "language_versions": {"zig": "0.13"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Embedded",
        "slug": "embedded",
        "description": "ARM GCC toolchain with OpenOCD and PlatformIO for embedded development",
        "icon": "arm",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            (
                "sudo apt-get update && sudo apt-get install -y "
                "gcc-arm-none-eabi gdb-multiarch openocd minicom"
            ),
            "pip install platformio",
        ],
        "environment_variables": {
            "PATH": "$HOME/.platformio/penv/bin:$PATH",
        },
        "default_ports": [],
        "language_versions": {"arm-gcc": "13"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "WebAssembly",
        "slug": "wasm",
        "description": "WebAssembly development with Emscripten and wasm-pack",
        "icon": "webassembly",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "git clone https://github.com/emscripten-core/emsdk.git $HOME/.emsdk",
            "cd $HOME/.emsdk && ./emsdk install latest && ./emsdk activate latest",
            "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
            "source $HOME/.cargo/env && cargo install wasm-pack",
        ],
        "environment_variables": {
            "PATH": "$HOME/.emsdk:$HOME/.emsdk/upstream/emscripten:$HOME/.cargo/bin:$PATH",
            "EMSDK": "$HOME/.emsdk",
        },
        "default_ports": [{"port": 8080, "label": "Dev Server", "protocol": "http"}],
        "language_versions": {"emscripten": "latest", "rust": "stable"},
        "is_official": True,
        "is_public": True,
    },
]
