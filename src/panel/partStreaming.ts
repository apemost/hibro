// React context carrying "this message is still streaming" down to fenced-block
// custom renderers. Needed because Streamdown's remend auto-closes an open
// fence for parsing, so a CustomRenderer's `isIncomplete` prop is false even
// while the block is mid-stream; the only trustworthy completeness signal is
// the run state, which the panel owns. Provided per message in App.tsx's
// MessageParts; false for any message that is not actively streaming.
import { createContext } from 'react';

export const PartStreamingContext = createContext(false);
