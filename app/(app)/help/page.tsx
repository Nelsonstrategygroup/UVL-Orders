// "How to use this" (SPEC 10, Phase 6): a short guide for Kathy and Chris,
// with screenshots from the app. Open to every role, from Settings.

import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";

export const metadata = { title: "How to use this · Umpqua Valley Lamb" };

function Shot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="m-0 my-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- plain screenshots, no resizing needed */}
      <img
        src={src}
        alt={alt}
        width={500}
        height={863}
        className="h-auto w-full max-w-[320px] rounded-[12px] border border-line"
        loading="lazy"
      />
      <figcaption className="small muted mt-1 max-w-[320px]">{caption}</figcaption>
    </figure>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-1">
        {n}. {title}
      </h3>
      <div className="text-[1.02rem] leading-relaxed">{children}</div>
    </section>
  );
}

export default async function HelpPage() {
  const user = await requireUser();
  const packer = user.role === "packing";

  const chris = (
    <section className="panel mt-4" aria-labelledby="for-chris">
      <h2 id="for-chris">For packing (Chris)</h2>
      <Step n={1} title="Open the app">
        Tap the <b>UV</b> icon on the tablet&apos;s home screen. You only log in once a day. If it asks in the morning, log in
        again. You only see the Packing screen.
      </Step>
      <Step n={2} title="Tap a row when it's packed">
        The whole row is the button. It turns green with a check. Tap it again to undo, or tap <b>Undo</b> at the top for a
        few seconds after.
        <Shot
          src="/help/packing.jpg"
          alt="The Packing screen with two packed lines in green and the All packed banner"
          caption="Green with a check means packed. When a customer is all packed, add the boxes and pallet."
        />
      </Step>
      <Step n={3} title="Packed a different amount?">
        Tap <b>Packed a different amount?</b> under the row, then use − and + and tap <b>Save</b>. The row turns red and says
        how many are short or over.
        <Shot
          src="/help/packing-short.jpg"
          alt="A shoulder line in red that says Packed 2, short 1"
          caption="Red with ! means short. Tap Change the count to fix it."
        />
      </Step>
      <Step n={4} title="Boxes and pallet">
        Under each customer, tap + for each box and type the pallet. It saves by itself and shows who packed it and when.
      </Step>
      <Step n={5} title="To pack, Done, All">
        <b>To pack</b> shows what&apos;s left. <b>Done</b> shows finished customers. <b>All</b> shows everyone. New orders show
        up by themselves within a few seconds.
      </Step>
      <Step n={6} title="Paper copy">
        Tap <b>Print a paper copy</b> for a checklist with spaces for packed counts, boxes, pallet, and initials.
      </Step>
    </section>
  );

  const kathy = (
    <section className="panel mt-4" aria-labelledby="for-kathy">
      <h2 id="for-kathy">For orders (Kathy)</h2>
      <Step n={1} title="Calls: one customer at a time">
        Open <b>Calls</b>. Customers whose call day is today come first, then call-backs. Tap the big button to call them.
        <Shot
          src="/help/calls.jpg"
          alt="The Calls screen showing one customer with a Call button and big buttons for their answer"
          caption="Tap Same as last week, Different order, No order this week, or Call back later."
        />
      </Step>
      <Step n={2} title="Entering an order">
        Tap <b>+</b> and <b>−</b>, or type a number. It saves by itself as you go. Cuts they usually buy are at the top.
        <Shot
          src="/help/order-editor.jpg"
          alt="The order screen with plus and minus buttons beside each cut"
          caption="Tap Done when you're finished. You can always come back and change it."
        />
      </Step>
      <Step n={3} title="Read it back">
        After saving, the order shows in big type. Read it back to the customer, then tap <b>Next</b>. If you tapped the wrong
        thing, tap <b>Undo</b> at the top.
        <Shot
          src="/help/read-back.jpg"
          alt="Saved. Read this back to them, with the order in large type"
          caption="Fix something opens the order again."
        />
      </Step>
      <Step n={4} title="This week: how many lambs">
        <b>This week</b> shows how many lambs to order and which part sets that number. Type <b>Your number</b> to use a
        different count. Fill in the producer and the processing day, then tap <b>Copy message</b> to text the producer.
        <Shot
          src="/help/this-week.jpg"
          alt="This week with 6 lambs to order and the message for the producer"
          caption="Follow-ups that are due show further down, each with a Done button."
        />
      </Step>
      <Step n={5} title="The cut sheet">
        Open <b>Cut sheet</b> from <b>More</b>. For a new week, tap <b>Copy the week of ...</b> and change the numbers. Red counts
        mean a set doesn&apos;t add up to whole lambs.
        <Shot
          src="/help/cut-sheet-check.jpg"
          alt="A set with a red count that says Front shanks 160 of 80"
          caption="Here the sheet lists front shanks twice: 160 of 80. Fix the line and the red goes away."
        />
        If customers are linked to a set, <b>Put these on this set</b> adds their orders to it.
      </Step>
      <Step n={6} title="Print it for Mohawk">
        At the bottom, <b>What Mohawk gets</b> shows the sheet as it prints. Tap <b>Print or save as PDF</b>. Printing marks it
        sent. If you change it later, the app says <b>Send an update</b>.
        <Shot
          src="/help/cut-sheet-print.jpg"
          alt="The printed sheet preview with the Print or save as PDF button"
          caption="Email to Mohawk sends a plain-text copy. Print is the colored one."
        />
      </Step>
      <Step n={7} title="Half and whole lambs, freezer, customers">
        <b>Half and whole</b> walks you through each cut. It says <b>In freezer</b> or <b>Cut fresh</b> for each, and anything
        the freezer can&apos;t cover is added to this week&apos;s order. Tap <b>Mark filled</b> when it&apos;s picked up.{" "}
        <b>Freezer</b> shows what&apos;s on hand. On a customer&apos;s page, <b>Log a contact</b> keeps notes and follow-ups.
      </Step>
    </section>
  );

  return (
    <div className="mx-auto max-w-[760px]">
      <h2>How to use this</h2>
      <p className="muted mt-1">Short steps for the jobs you do each week.</p>

      <section className="panel mt-4">
        <h3>For everyone</h3>
        <ul className="mb-0 list-disc space-y-2 pl-5 text-[1.02rem] leading-relaxed">
          <li>
            You stay logged in all day. At 3 in the morning it logs you out; the next time you open it, log in again.
          </li>
          <li>Almost everything saves by itself. Quick taps show an <b>Undo</b> button at the top for a few seconds.</li>
          <li>If it says &ldquo;Couldn&apos;t save,&rdquo; check the internet and try again.</li>
          <li>
            Words too small? Tap <b>Settings</b> at the top and turn on <b>Larger text</b>.
          </li>
          <li>
            Put it on your home screen like an app. On an iPhone or iPad, open it in Safari, tap the Share button, then{" "}
            <b>Add to Home Screen</b>. On Android, open it in Chrome, tap the menu, then <b>Install app</b> or{" "}
            <b>Add to Home screen</b>.
          </li>
        </ul>
      </section>

      {packer ? chris : kathy}
      {!packer && chris}

      <p className="mt-6">
        <Link href={packer ? "/packing" : "/calls"} className="btn">
          {packer ? "Back to Packing" : "Back to Calls"}
        </Link>
      </p>
    </div>
  );
}
