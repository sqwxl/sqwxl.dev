+++
title = "Writing a text editor in Rust - Part 1"
date = 2023-09-02
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

I'll try to keep the code modular as far as it makes sense; this will help keep the codebase clean and understandable and make it easier to add new features in the future.

I'll try to keep library dependencies to a minimum where the core application code is concerned; just to dig into the standard library some more.

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
1. The changes are reflected in the UI


## Laying the Foundations

OK! Let's get started.

```bash
cargo new edythe
```

I'm calling it `edythe`; it was my grandmother's name, and it sounds a bit like "edit".

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

I'll also implement some structs to organize the code: `Buffer` to hold the actual text data and methods to modify it; `Editor` as an abstraction layer of the buffer; `Tui` to take handle events and writing to screen.

```rust
// main.rs

use std::fs::File;
use std::io::{BufWriter, Stdout, Write};
use std::path::PathBuf;

use clap::Parser;
use crossterm::{cursor, queue};
use crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    execute,
    style::Print,
    terminal,
};

#[derive(Debug)]
enum BufferPath {
    File(PathBuf),
    Temp(usize),
}

struct Buffer {
    path: BufferPath,
    data: String,
}
impl Buffer {
    fn new(path: BufferPath, data: String) -> Self {
        Self { path, data }
    }

    fn append_char(&mut self, c: char) {
        self.data.push(c);
    }

    fn delete_char_from_end(&mut self) {
        if !self.data.is_empty() {
            self.data.pop();
        }
    }
}

struct Editor {
    buffer: Buffer,
}
impl Editor {
    fn new(buffer: Buffer) -> Editor {
        Editor { buffer }
    }

    fn save_to_disk(&self) -> std::io::Result<()> {
        if let BufferPath::File(ref file_path) = self.buffer.path {
            let mut f = BufWriter::new(File::create(file_path)?);
            f.write(self.buffer.data.as_bytes())?;
        }

        Ok(())
    }

    fn insert_char(&mut self, c: char) {
        self.buffer.append_char(c);
    }

    fn delete_last_char(&mut self) {
        self.buffer.delete_char_from_end();
    }
}

#[derive(Debug)]
enum EditorEvent {
    Edited,
    Quit,
    Continue,
}

struct Tui {
    out: Stdout,
    editor: Editor,
}

impl Tui {
    fn new(editor: Editor) -> Self {
        Self {
            // Crossterm is can write to any buffer that is `Write`, in our case, that's just stdout
            out: std::io::stdout(),
            editor,
        }
    }

    fn run(&mut self) {
        // The "alternate screen" is like another window or tab that you can draw to. When it's closed
        // the user is returned to the regular shell prompt. This is how "full-screen" terminal apps
        // like vim or htop do it.
        execute!(&self.out, terminal::EnterAlternateScreen).unwrap();

        // By default the terminal acts sort of like the default text input of the shell. By enabling
        // "raw mode" crossterm gives us full control of what and how stuff gets displayed.
        terminal::enable_raw_mode().unwrap();

        // first draw
        self.draw();
        // This is the main loop our app runs in.
        loop {
            match self.read_input() {
                EditorEvent::Continue => continue,
                EditorEvent::Quit => break,
                EditorEvent::Edited => {
                    self.draw();
                }
            };
        }

        terminal::disable_raw_mode().unwrap();
        execute!(&self.out, terminal::LeaveAlternateScreen).unwrap();
    }

    fn draw(&mut self) {
        queue!(
            &mut self.out,
            terminal::Clear(terminal::ClearType::All),
            cursor::MoveTo(0, 0),
            Print(&self.editor.buffer.data)
        )
        .unwrap();
    }

    fn read_input(&mut self) -> EditorEvent {
        match event::read().unwrap() {
            Event::Key(key_event) => self.match_keyevent(key_event),
            Event::Resize(_, _) => EditorEvent::Continue, // TODO
            Event::Mouse(_) => EditorEvent::Continue,     // TODO
            _ => EditorEvent::Continue,
        }
    }

    fn match_keyevent(&mut self, key_event: KeyEvent) -> EditorEvent {
        match key_event {
            KeyEvent {
                code: KeyCode::Char('c'),
                modifiers: KeyModifiers::CONTROL,
                ..
            } => return EditorEvent::Quit,
            KeyEvent {
                code: KeyCode::Char('s'),
                modifiers: KeyModifiers::CONTROL,
                ..
            } => self
                .editor
                .save_to_disk()
                .expect("I couldn't save the file for some reason."),
            KeyEvent {
                code: KeyCode::Backspace,
                ..
            } => self.editor.delete_last_char(),
            KeyEvent {
                code: KeyCode::Char(c),
                ..
            } => self.editor.insert_char(c),
            _ => return EditorEvent::Continue,
        }

        EditorEvent::Edited
    }
}

// Define the command line arguments
#[derive(Parser)]
struct Args {
    #[arg()]
    file: Option<PathBuf>,
}

fn main() {
    let args = Args::parse();

    let buffer = match args.file {
        Some(path) => {
            // read file content into buffer; or empty string if the file doesn't exist
            let data = std::fs::read_to_string(&path).unwrap_or_default();

            Buffer::new(BufferPath::File(path), data)
        }
        None => Buffer {
            path: BufferPath::Temp(0),
            data: String::new(),
        },
    };

    let editor = Editor::new(buffer);

    let mut tui = Tui::new(editor);

    tui.run();
}
```

This works reasonably well as a naive implementation. A first thing I noticed though is that newlines are not causing the cursor to return to the beginning of the next line. So files end up looking like this:

![](/images/newline-bug.png)

This is an easy fix, we just need to update the draw function to get the cursor to reset to the first column for each new line.

```rust
// main.rs

fn draw(&mut self) {
        queue!(
            &mut self.out,
            terminal::Clear(terminal::ClearType::All),
            cursor::MoveTo(0, 0),
        )
        .unwrap();

        let mut lines = self.editor.buffer.data.lines();
        
        // print the first line
        queue!(&mut self.out, Print(lines.next().unwrap_or(""))).unwrap();

        // reset the cursor before each subsequent line
        for line in lines {
            queue!(&self.out, cursor::MoveToNextLine(1), Print(line),).unwrap();
        }

        self.out.flush().unwrap();
    }
```

OK, cool! Now I can open files and they show up reasonably well, but editing is still rather limited as the following recording shows. 

![](/images/edythe_recording_1.gif)

I can type in some text, but I can't add any new lines. I also can't scroll up or down if the text is higher than the window. The last line seems to show the current cursor position and adding or removing text leads to unexpected behavior.

But it's a start! I'll tackle these problems and more in part two...



