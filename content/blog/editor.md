+++
title = "Writing a text editor in Rust"
draft = true
date = 2023-03-13
+++

I've been teaching myself Rust for some months now, but I've yet to apply what I've learned to anything "big". I think writing a text editor in Rust could be a good way both to apply what I already know, as well as broaden my knowledge. I'll keep things "simple": a basic command line text editor that can edit one file at a time.


## Requirements

* Read and display a single file as text
* Allow the user to edit the text. Which means the ability to...
    - write and erase characters
    - select sequential characters
    - cut, copy & paste characters to and from the system clipboard
    - undo/redo changes
    - scroll up & down
* Write changes to a file or save a new file to disk


## Application design

At a minimum, our project will need to have the following modules in order to meet the requirements:

* Some kind of text buffer
* Some way of describing the edits that can be applied to the text buffer
* A stack of edits for undo history
* A terminal user interface to display text and capture keystrokes
* Cursor and Selection objects
* An IO module to interface with the file system and clipboard

Part of this will comprise the "core" or "backend" of the application, and will be responsible for storing and manipulating the actual data in memory (i.e. the text buffer and undo stack) as well as reading and writing to disk. What the user actually interacts with will be the "frontend": in this case a terminal user interface that will be responsible for displaying the text returned by the backend, displaying the cursor/selection and converting keystrokes to edits that will be sent to the backend.

In terms of API, this means that the core of the application has no notion of displaying text, it only cares about text data and text edits. And the frontend doesn't care how the text data is actually stored and mutated, all it's concerned with is displaying some text and handling keystrokes.\
Having a modular design like this should help keep the codebase clean and maintainable and should make it easier to add new features in the future. Like adding a graphical frontend, for example.

The application flow will look something like this:
1. The user starts the application passing in a path to a file they wish to edit
1. The app reads the file into memory and passes it to the backend which converts the data to some kind of text buffer
1. The app initializes the frontend within a loop construct
1. The frontend requests text to display from the backend which returns a representation of the text buffer
1. The frontend parses this representation and writes/draws to stdout
1. The app now waits for user input (keystrokes)
1. The user moves the cursor and selects some text they wish to delete
1. The frontend sends an edit to the backend that says something like "delete the characters from index 42 to index 53"
1. The backend responds with the new text with the selected characters removed
1. The changes are reflected in the ui


## Laying the Foundations

OK! Let's get started.

```bash
cargo new dorite
```
I'm calling this package dorite just cause I think it sounds alright and it's an anagram for 'editor'.

I'd like to get something I can play with as soon as possible so let's start by getting our app to the contents of a file.\
I'm using `clap` to parse the command line arguments. I'll be using some convenience libraries where it makes sense, but I'll try to stick to the standard library for the core application code; just so I familiarize myself with it more.

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

We can now run `cargo run --quiet src/main.rs` and our program will print itself! But it's just static text; it gets dumped to stdout and the process immediately exits. In order to make it editable, we need to do a couple things.
1. `println!` won't be enough. We need to have some way to "draw" to the terminal.
    - This is actually complex enough that it warrants reaching for another crate. We'll use `crossterm` because it's popular, well documented and tested on numerous terminal emulators.
1. We don't want the program to exit right away. We need to implement a looping construct where we listen for keystrokes and go through the steps outlined above.
    - `crossterm` has an `Event` module which will be perfect for this.
1. The content of the file should be stored somewhere so that we can edit it.
    - We'll just use `String` for now and think about more sophisticated solutions later.

As a start, let's try to implement this with a single working key: backspace. When we hit that key, the last character on display should be removed.
