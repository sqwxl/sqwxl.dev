+++
draft = true
date = 2023-03-13
+++


# Writing a text editor in Rust

I've been teaching myself Rust for some months now, but I've yet to apply what I've learned to anything "big".\
I think writing a *simple* text editor in rust is a good way both to apply what I already know, as well as broaden my knowledge.

There are all kinds of editors out there, from the most basic command line editors like `nano`, to full-featured extensible ones with whole ecosystems of plugins and extensions like `vim` or even IDEs.\
For this experiment, I'd like to keep things simple -- no bells, no whistles. All this editor really needs to do is allow the user to open text files, edit them, and save them.

I would like to write a graphical application leveraging the GPU just because I'm curious about that stuff, but I think I'll be modest and just make a CLI for now. I can always come back and add a graphical frontend later.


## Minimal Requirements

At a minimum our editor must do the following:

* Read and display a single file as text
* Allow the user to edit the text. Which means the ability to...
    - write and erase text
    - select continuous text regions
    - cut, copy & paste text to and from the system clipboard
    - undo/redo changes
    - scroll up & down
* Write changes to a file or save a new file to disk


## Application design

We'll try to keep the code modular as far as it makes sense; this will help keep the codebase clean and understandable anb make it easier to add new features in the future.

I'll try to keep library dependencies to a minimum where the core application code is concerned; just to dig into the standard library some more.

At a minimum, our project will need to have the following modules in order to meet the requirements:

* Some kind of buffer to store text in memory
* Some way of describing the edits that can be applied to the text buffer
* A stack of edits for undoing/redoing
* A terminal user interface to display text and capture keystrokes
* A cursor

For now everything can live in the same crate:

```
src/
├── backend.rs
├── edits.rs
├── text_buffer.rs
├── cursor.rs
├── main.rs
└── tui.rs
```


## Laying the Foundations

Let's start by creating the project:

```bash
cargo new dorite
```

I'm calling it `dorite` just cause I think it sounds ok and it's an anagram for editor.

I'd like to get something I can play with as soon as possible so let's start by getting our app to display a file.\
I'm using `clap` to parse the command line arguments.

```rust
// main.rs
use std::path::PathBuf;

use clap::Parser;

// Define the command line arguments
#[derive(Parser)]
struct Args {
    #[arg()]
    file: Option<PathBuf>,
}

fn main() {
    let args = Args::parse();

    if let Some(file_path) = args.file {
        // Read file content and display it
        let content = std::fs::read_to_string(file_path).unwrap();
        println!("{}", content);
    }
}
```

We can now run `dorite somefile.txt` and the content of the file gets printed. But it's just static text, in order to make it editable, we need to:
1. We must implement a loop in the main function to listen for user inputs
2. We need to store the text from the file in memory somehow and display it.
