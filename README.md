# Optimization Galaxy

One live record per stone, shared by the three companies that touch it: the
factory that cuts it, the exporter that ships it, and the importer that pays
for it. The agents read the paperwork those companies already send each other,
check it against itself, plan the cut, price the result, and produce the filing
that lets the parcel move.

Live at **https://agents.jewellabs.org**

## The problem

One parcel touches four companies in three countries and today it runs on
twenty WhatsApp threads. Since 1 January 2026 every natural polished diamond of
0.5 carats or more entering the European Union needs a Due Diligence Statement.
A wrong origin field costs up to 40 percent of the shipment plus seizure. A
sanctioned stone that slips through is 377,700 dollars per violation or twice
the transaction, whichever is greater.

No single party can produce that filing. The importer has the price, the
exporter has the certificates, the factory has the stone.

## What runs here

Press **Run shipment** and the following happens in order, all of it real:

1. **Documents are read.** The Kimberley Process certificate, the grading
   report and the invoice are put through optical character recognition. Every
   field comes back with a confidence, and an identity field such as a report
   number is never accepted from a single read, because one wrong character
   still has a valid shape. It needs a second document that agrees, or a named
   person.
2. **The scan is analysed.** A convolutional network trained in `ml/` slides
   over the rough and marks the flaws.
3. **The cut is planned.** Polished shapes are fitted inside the stone, around
   the flaws rather than through them.
4. **A gate runs before the saw.** A policy learned by reinforcement decides
   cut or hold for each planned stone, and prints its reasons.
5. **Origin is proved.** The rule set is evaluated as versioned data. A check
   that cannot see its inputs is marked unknown, and unknown never passes.
6. **The output is attacked.** A second agent tries to refute every filed value
   from the source documents, and refuses anything it cannot re-derive.
7. **It is priced.** List price, the house discount, then the duty the country
   of polish sets, which compliance already proved.
8. **A person signs.** Only then is the statement assembled, sealed with a
   content hash, and appended to the audit chain.

If the documents disagree, nothing is produced. That is the point: it stops at
the desk rather than at the border.

## The models

Both are trained by the scripts in `ml/`, and `ml/README.md` describes them in
full.

- **Inclusion classifier**, a convolutional network written directly against
  numpy, forward and backward passes included. Colour supplies the label and
  luminance is the only input, so it cannot learn "green means flaw".
- **Cut or hold policy**, learned by REINFORCE. State is what the scan says,
  action is cut or hold, reward is money. The learned weights read as plain
  sense: cut by default, hold when the stone is flawed inside, chipped at the
  rim, under grade, or too small.

`node test/parity.js` proves the browser forward pass and the Python trainer
agree to floating point noise on real patches.

## Running it

Static, no build step. Open `index.html` and everything except the shared
session works. For the full thing:

    node server.js         # http://localhost:4610

The server adds local optical character recognition through the tesseract
binary, and a session server so companies on other machines can join. Without
it the browser does the reading itself in WebAssembly, and windows on one
machine share a session between them.

To train the models:

    python3 -m venv .venv && .venv/bin/pip install numpy pillow
    .venv/bin/python ml/train.py
    .venv/bin/python ml/rl.py

## Layout

    index.html            the workspace
    css/app.css           design system, one dark theme, tokens only
    js/                   browser: reading, scan model, planner, session, workspace
    src/                  domain: extraction, rules, gate, quoting, agents, audit
    rules/                regulations as versioned data, not code
    ml/                   the two models, their training and their artefacts
    assets/docs/          the documents, real reports and marked specimens
    test/parity.js        proves the browser matches the trainer

## Honesty

Prices, duty rates and the house discount are indicative. The mining
certificates and the reactor record are specimens, marked as such across the
face of every page, and the grading reports are genuine. The reinforcement
learner is trained against a simulator built from the same evidence the gate
sees; `sample_outcome` in `ml/rl.py` is the only place the environment lives,
and real cut outcomes replace it without changing anything else.
