# dotfiles

These dotfiles are managed with chezmoi and are primarily for macOS. The repo assumes Homebrew, zsh, tmux, Neovim, and jj. It also contains a `run_onchange_brew-packages.sh.tmpl` script, so `chezmoi apply` installs the Homebrew formulae and casks listed there when that script changes.

## Fresh machine bootstrap

On a new macOS machine, install the Xcode command line tools first:

```sh
xcode-select --install
```

Then install Homebrew:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install chezmoi:

```sh
brew install chezmoi
```

Pull and apply the dotfiles:

```sh
chezmoi init --apply https://github.com/sebvilhelm/dotfiles.git
```

The first run generates the chezmoi config from `.chezmoi.toml.tmpl` and prompts for `github_signing_key` and whether the machine should apply work-specific settings. On work machines it also prompts for `lunar_name` and `lunar_email`. Provide the values you want used by the included git/jj signing and work git config.

If the template data changes later, regenerate the config and re-apply with:

```sh
chezmoi apply --init
```

## Machine-specific notes

Work-specific files are only applied when `work_laptop` is true in chezmoi data.

## After the first apply

If you use the included git/jj signing setup, sign in to the 1Password app after the Brew bundle installs it. The configs call `/Applications/1Password.app/Contents/MacOS/op-ssh-sign`.

The git config also uses `gh auth git-credential`, so authenticate GitHub once:

```sh
gh auth login
```

`tmux` expects TPM to exist:

```sh
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```

Then start tmux and press `Ctrl-a I` once to install plugins. The tmux prefix in this config is `Ctrl-a`.

If you want a local Neovim build, clone `neovim/neovim`, install its build dependencies, and build it with `make CMAKE_BUILD_TYPE=Release`.

Open `nvim` once to let `lazy.nvim` clone and install plugins.

Firefox settings are applied via a managed `user.js` in `~/Library/Application Support/Firefox/Profiles/managed.default-release`, and selected extensions are copied into that profile's `extensions/` directory. `chezmoi apply` creates or migrates the default profile and updates Firefox's profile registry, so there is no first-launch bootstrap step. Quit Firefox before applying.

One local extra is still referenced but not managed here. Add it manually if you use it:

- `~/lunar.zsh`

Finally, start a fresh shell:

```sh
exec zsh
```
