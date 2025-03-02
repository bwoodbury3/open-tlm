# open-tlm

An open source time-series database optimized for real-time visualization in the web browser.

![open-tlm-demo.gif](doc/img/open-tlm-demo.gif)

`open-tlm` is:
* A database which stores time-series data (i.e. a temperature sensor captured at 10Hz).
* A user interface for searching and plotting data, accessed from any web browser.
* A public HTTP API for posting/getting raw data.

## Getting Started

### Install
```bash
$ python3.11 -m venv venv
$ . venv/bin/activate
(venv) $ python -m pip install -r requirements.txt
```

### Run
```bash
(venv) python server.py
```

Navigate your browser to `localhost:8080`. `open-tlm` logs some internal metrics under `index`.

## Posting Data

To upload an existing dataset, use the script in `examples/upload_data.py`.

An official API doc is not available yet, but check out the `examples` directory in this repository for some simple examples. Learning by example is better anyway.

## Acknowledgements and Caveats

This project really works, but is still in early stages and is lacking many standard features, as well as a proper install/deploy system.

`open-tlm` is powered by flask 🧪 and proudly uses zero frontend libraries (ok fine it uses bootstrap).