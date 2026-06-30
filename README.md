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

The first run generates the chezmoi config from `.chezmoi.toml.tmpl` and prompts for `github_signing_key`. Provide the value you want used by the included git/jj signing config.

If the template data changes later, regenerate the config and re-apply with:

```sh
chezmoi apply --init
```

## Machine-specific notes

The `.work/` overlay is only applied when `chezmoi.hostname` is `work-laptop`. If this machine should receive those files, make sure the hostname matches before the first apply.

## After the first apply

If you use the included git/jj signing setup, install the 1Password app too. The configs call `/Applications/1Password.app/Contents/MacOS/op-ssh-sign`.

The git config also uses `gh auth git-credential`, so authenticate GitHub once:

```sh
gh auth login
```

`tmux` expects TPM to exist:

```sh
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```

Then start tmux and press `Ctrl-a I` once to install plugins. The tmux prefix in this config is `Ctrl-a`.

Open `nvim` once to let `lazy.nvim` clone and install plugins.

A couple of local extras are referenced but not managed here. Add them manually if you use them:

- `~/lunar.zsh`
- `~/.claude/statusline-command.sh`

Finally, start a fresh shell:

```sh
exec zsh
```
