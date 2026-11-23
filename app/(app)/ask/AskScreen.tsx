"use client";

// The Ask screen: the same conversation as the side panel (components/ask),
// full width. Phones open Ask here, from More or My account.

import AskChat from "@/components/ask/AskChat";

export default function AskScreen() {
  return <AskChat autoFocus />;
}
