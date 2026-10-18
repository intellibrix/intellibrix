FROM debian:13-slim

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest
ARG NODE_MAJOR=22

# Install basic development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  htop \
  tree \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  ca-certificates \
  gh \
  dnsutils \
  jq \
  nano \
  vim \
  fontconfig \
  net-tools \
  curl \
  wget \
  build-essential \
  libssl-dev \
  zlib1g-dev \
  libbz2-dev \
  libreadline-dev \
  libsqlite3-dev \
  libffi-dev \
  liblzma-dev \
  direnv \
  ripgrep \
  fd-find \
  bat \
  locales \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# en_US.UTF-8 -- Debian slim images ship with only the C locale by default,
# which can cause subtly broken sorting/formatting in some CLI tools.
RUN echo "en_US.UTF-8 UTF-8" > /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

# Debian packages fd/bat under fdfind/batcat to avoid clashing with unrelated
# existing binaries -- symlink them to the names everyone actually expects.
RUN ln -s /usr/bin/fdfind /usr/local/bin/fd && \
  ln -s /usr/bin/batcat /usr/local/bin/bat

# eza isn't in Debian 13's apt repos -- install from its own release binary.
ARG EZA_VERSION=v0.20.2
RUN ARCH=$(dpkg --print-architecture) && \
  case "$ARCH" in \
    amd64) EZA_ARCH=x86_64-unknown-linux-gnu ;; \
    arm64) EZA_ARCH=aarch64-unknown-linux-gnu ;; \
    *) echo "unsupported arch: $ARCH" && exit 1 ;; \
  esac && \
  wget -q -O /tmp/eza.tar.gz \
    "https://github.com/eza-community/eza/releases/download/${EZA_VERSION}/eza_${EZA_ARCH}.tar.gz" && \
  tar -xzf /tmp/eza.tar.gz -C /usr/local/bin && \
  rm /tmp/eza.tar.gz

# zoxide -- smarter `cd` that learns frequently-visited directories.
# Installs to /usr/local/bin (already on PATH for every user/shell here).
RUN curl -fsSL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | \
  sh -s -- --bin-dir /usr/local/bin

# lazygit -- terminal UI for git (stage hunks, browse log/branches, rebase).
ARG LAZYGIT_VERSION=0.46.0
RUN ARCH=$(dpkg --print-architecture) && \
  case "$ARCH" in \
    amd64) LAZYGIT_ARCH=x86_64 ;; \
    arm64) LAZYGIT_ARCH=arm64 ;; \
    *) echo "unsupported arch: $ARCH" && exit 1 ;; \
  esac && \
  wget -q -O /tmp/lazygit.tar.gz \
    "https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_Linux_${LAZYGIT_ARCH}.tar.gz" && \
  tar -xzf /tmp/lazygit.tar.gz -C /usr/local/bin lazygit && \
  rm /tmp/lazygit.tar.gz

# Node.js from NodeSource -- debian:13-slim has no node package at a pinned
# major version, so add the upstream repo explicitly instead of relying on
# whatever's in Debian's own archive.
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - && \
  apt-get install -y --no-install-recommends nodejs && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# node:22's image ships a non-root `node` user (uid/gid 1000) by default --
# recreate that here so the rest of this file (chown targets, USER node,
# devcontainer's remoteUser, etc.) doesn't need to change.
RUN groupadd --gid 1000 node && \
  useradd --uid 1000 --gid node --shell /bin/bash --create-home node && \
  echo "node ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/node && \
  chmod 0440 /etc/sudoers.d/node

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history && export HISTSIZE=50000 && export HISTFILESIZE=50000 && export HISTCONTROL=ignoredups:erasedups" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory \
  && echo "$SNIPPET" >> "/home/$USERNAME/.bashrc"

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions
RUN mkdir -p /workspace /home/node/.claude && \
  chown -R node:node /workspace /home/node/.claude

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  sudo dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Set up non-root user
USER node

# Wire delta in as git's diff/merge pager (as the `node` user -- this is a
# per-user global config, not system-wide) so the install above is actually used.
RUN git config --global core.pager delta && \
  git config --global interactive.diffFilter "delta --color-only" && \
  git config --global delta.navigate true && \
  git config --global merge.conflictstyle diff3 && \
  git config --global diff.colorMoved default

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Enable corepack so pnpm/yarn are available at whatever version a target
# repo's package.json pins, without baking in a specific version here.
RUN sudo corepack enable --install-directory /usr/local/bin || true

# mise -- per-project runtime version manager (https://mise.jdx.dev). The
# base image's own Node/npm stay as the container-wide default; mise lets
# an individual repo pin/override its own tool versions via .mise.toml
# without rebuilding this image.
RUN curl -fsSL https://mise.run | sh
ENV PATH=$PATH:/home/node/.local/bin
ENV MISE_DATA_DIR=/home/node/.local/share/mise

# Python -- installed and set as the container-wide global default via mise,
# rather than Debian's own python3/pip (which is externally-managed and
# blocks plain `pip install`). Per-project versions can still override this
# with their own .mise.toml.
ARG PYTHON_VERSION=3.13
RUN /home/node/.local/bin/mise use --global python@${PYTHON_VERSION}

# Rust/Cargo -- via rustup (the standard install path for a system-wide
# toolchain), rather than mise, since most Rust tooling docs assume rustup.
ENV RUSTUP_HOME=/home/node/.rustup
ENV CARGO_HOME=/home/node/.cargo
ENV PATH=$PATH:/home/node/.cargo/bin
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
  sh -s -- -y --default-toolchain stable --profile default

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# zsh quality-of-life plugins (autosuggestions, syntax highlighting) + fzf
# key bindings. No theme framework here -- Starship (installed below) owns
# the prompt instead of oh-my-zsh/powerlevel10k.
RUN git clone --depth=1 https://github.com/zsh-users/zsh-autosuggestions \
    ${ZDOTDIR:-$HOME}/.zsh/zsh-autosuggestions && \
  git clone --depth=1 https://github.com/zsh-users/zsh-syntax-highlighting \
    ${ZDOTDIR:-$HOME}/.zsh/zsh-syntax-highlighting

# Starship prompt -- single static binary, fast, cross-shell, highly
# themeable via TOML (see .devcontainer/starship.toml). Installed as root
# since the `node` user has no general-purpose passwordless sudo.
USER root
RUN sh -c "$(wget -O- https://starship.rs/install.sh)" -- --yes
USER node

# A Nerd Font so Starship's glyphs (branch icons, language logos, symbols)
# render correctly in any terminal that picks it up as a fallback font.
RUN mkdir -p /home/node/.local/share/fonts && \
  wget -q -O /tmp/meslo.zip \
    "https://github.com/ryanoasis/nerd-fonts/releases/latest/download/Meslo.zip" && \
  unzip -q -o /tmp/meslo.zip -d /home/node/.local/share/fonts \
    "MesloLGSNerdFontMono-Regular.ttf" "MesloLGSNerdFontMono-Bold.ttf" \
    "MesloLGSNerdFontMono-Italic.ttf" "MesloLGSNerdFontMono-BoldItalic.ttf" && \
  rm /tmp/meslo.zip && fc-cache -f

COPY --chown=node:node starship.toml /home/node/.config/starship.toml

RUN echo '\n# --- zsh plugins ---' >> /home/node/.zshrc && \
  echo 'source ${ZDOTDIR:-$HOME}/.zsh/zsh-autosuggestions/zsh-autosuggestions.zsh' >> /home/node/.zshrc && \
  echo 'source ${ZDOTDIR:-$HOME}/.zsh/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh' >> /home/node/.zshrc && \
  echo 'bindkey "^R" history-incremental-search-backward' >> /home/node/.zshrc && \
  echo '\n# --- starship prompt ---' >> /home/node/.zshrc && \
  echo 'eval "$(starship init zsh)"' >> /home/node/.zshrc && \
  echo '\n# --- direnv ---' >> /home/node/.zshrc && \
  echo 'eval "$(direnv hook zsh)"' >> /home/node/.zshrc && \
  echo '\n# --- zoxide ---' >> /home/node/.zshrc && \
  echo 'eval "$(zoxide init zsh)"' >> /home/node/.zshrc && \
  echo '\n# --- mise ---' >> /home/node/.zshrc && \
  echo 'eval "$(mise activate zsh)"' >> /home/node/.zshrc && \
  echo '\n# --- history ---' >> /home/node/.zshrc && \
  echo 'HISTSIZE=50000' >> /home/node/.zshrc && \
  echo 'SAVEHIST=50000' >> /home/node/.zshrc && \
  echo 'setopt HIST_IGNORE_DUPS HIST_IGNORE_SPACE HIST_EXPIRE_DUPS_FIRST INC_APPEND_HISTORY SHARE_HISTORY' >> /home/node/.zshrc

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
