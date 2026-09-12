/**
 * The writing contract handed to the host writer with every reporter's packet.
 * The checker (markdownPiece.ts) enforces every line it can enforce mechanically.
 */
export const WRITING_CONTRACT = `WRITING CONTRACT. The checker enforces what it can; you own the rest.

1. ORDER. An H1 headline, then the story as prose paragraphs, then a "## Pull quotes" section, and nothing else. The per-question view is appended by the checker, verbatim from the transcript. Do not write it.

2. THE STORY IS A STORY. A headline (a short verbatim quote works well, and must also appear inside a cited quote later in the piece), an optional one-line dek in *italics* built only from brief facts, a lede that says who this is, an arc (what the work was like, what set off the change, the decision, the rollout, the results), and a kicker. Prose only: no bullets, no numbered lists, no Q and A.

3. EVERY QUOTE IS VERBATIM AND CITED. Every quoted span in the story and in the pull quotes is verbatim from a SUBJECT turn and is followed by its timestamp as (MM:SS). Use curly quotes. A final period may become a comma before attribution. You may elide with one ellipsis inside a single turn, keeping order, with fragments of at least three words. Never quote the agent. A quoted span without a timestamp, or a timestamp without a quote, fails the piece.

4. CONNECTIVE PROSE FRAMES, IT DOES NOT ASSERT. Sentences between quotes may set up, sequence and attribute ("The first thing Teague described was Monday morning."). They may never state a fact about the subject or the business that is not inside a cited quote. No number or figure appears outside a quote; the checker fails the piece if one does.

5. THE ANGLE CHOOSES EMPHASIS, NEVER WORDS. Do not print the angle as if the subject said it. Do not paraphrase the subject's claims into your own sentences. Attribute plainly ("Teague said") and vary the frames: the checker fails a piece where more than one sentence starts with "Asked" or where "said:" appears more than once.

6. PULL QUOTES. Three to seven lines, each on its own line as > "quote" (MM:SS), chosen for the angle, each a whole thought.

7. VOICE. Plain, concrete, reported. No hype adjectives, no invented enthusiasm, nothing the person did not say.`;
