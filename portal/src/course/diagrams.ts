/**
 * Hand-authored SVG diagrams.
 *
 * Drawn against the portal's own tokens -- `var(--rule)`, `var(--warn)`,
 * `var(--muted)` -- so a diagram reads as part of the page rather than as an
 * embedded artifact, and follows the theme without a second theme to maintain.
 *
 * Entity boxes carry a small kind badge in the top-left -- NAMESPACE, WORKFLOW --
 * in the same letter-spaced caps the zone headings use, one step dimmer. It exists
 * because a name does not reliably say what a thing is: `ns-orders` in challenge 3
 * is a WORKFLOW sitting one zone away from a real namespace, and every student who
 * reads that box as a namespace has been misled by our own naming.
 *
 * The badge is a TEMPORAL vocabulary only. Kubernetes has namespaces too, and
 * challenge 4 draws one right next to a Temporal one -- badging both NAMESPACE
 * made the word mean two things in a single picture, which is worse than not
 * labelling it. The k8s container keeps the kubectl idiom, `ns worker-orders`,
 * and the badge stays reserved for what Temporal Cloud calls a namespace. The badge is
 * also why subtitles no longer start with "Namespace ·" -- the kind moved out of
 * the sentence, and the sentence now carries only the fact worth reading.
 *
 * One colour rule holds across all four, and it is the thing to preserve when editing:
 * a DOTTED YELLOW stroke is what this challenge adds -- boxes and edges alike, so
 * the eye can pick the new work out of the picture without reading a word. Everything a student already has
 * stays muted, so the picture answers "what is new here" before it is read. Lab 3
 * is the one place another colour earns a place -- the hand edit is drawn in
 * `var(--fail)`, because it is not a component being added, it is the damage the
 * loop has to undo.
 *
 * Mermaid was tried and dropped. It draws a correct picture with someone else's
 * taste: its own palette, its own spacing, and a layout engine that decides where
 * things go -- and it cost a runtime dependency, a client component to render it,
 * and a jsdom-based checker to prove the source parsed. Four labs do not need a
 * layout engine.
 *
 * The cost of this instead is that a change means moving coordinates by hand, and
 * nothing checks the result but your eyes. That is the trade, and it is only worth
 * it for a diagram whose layout has settled.
 */

/**
 * Challenge 2's opening state: what exists, and what is inert.
 *
 * Dashed means "not yet" -- the namespace nobody has provisioned, and the work
 * that cannot run because nothing is registered. That distinction is the whole of
 * the challenge, so it carries the only visual weight here.
 *
 * The layout is built around one constraint: `tpctl` talks to the control
 * namespace WITHOUT going through the cluster, and the picture has to show that.
 * So the top band (y 76-136) is kept clear all the way across for that one edge,
 * and everything in Kubernetes sits below it. An earlier version ran the line
 * straight through the worker box, which drew the opposite of what it
 * meant -- that the CLI talks to the worker, which it never does.
 */
export const LAB2_SVG = `<svg viewBox="0 0 880 344" role="img"
     aria-label="Your laptop holds a spec and tpctl, which starts a workflow directly on the control namespace. Kubernetes runs the Platform Temporal Worker, which polls that namespace and reads its key from Vault. The orders namespace does not exist yet."
     xmlns="http://www.w3.org/2000/svg" font-family="inherit">
  <defs>
    <marker id="l2a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--faint)"/>
    </marker>
    <marker id="l2b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--warn)"/>
    </marker>
  </defs>

  <!-- zones -->
  <g fill="none" stroke="var(--rule)" stroke-width="1">
    <rect x="8"   y="44" width="228" height="256" rx="8"/>
    <rect x="288" y="44" width="252" height="256" rx="8"/>
    <rect x="592" y="44" width="280" height="256" rx="8"/>
  </g>
  <g font-size="12" fill="var(--muted)" letter-spacing="0.06em">
    <text x="22"  y="34">YOUR LAPTOP</text>
    <text x="302" y="34">KUBERNETES</text>
    <text x="606" y="34">TEMPORAL CLOUD</text>
  </g>

  <!-- laptop: tpctl on the top band so its edge to the cloud runs level -->
  <g>
    <rect x="32" y="76" width="180" height="44" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="122" y="103" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">tpctl</text>

    <rect x="32" y="182" width="180" height="52" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="122" y="205" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">specs/orders.yaml</text>
    <text x="122" y="222" text-anchor="middle" font-size="11" fill="var(--muted)">the request</text>
  </g>
  <path d="M122,182 L122,126" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l2a)"/>

  <!-- kubernetes: below the top band, so nothing sits under the tpctl edge -->
  <g>
    <rect x="312" y="152" width="204" height="60" rx="6" fill="none"
          stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5"/>
    <text x="414" y="175" text-anchor="middle" font-size="13" fill="var(--warn)">Platform Temporal Worker</text>
    <text x="414" y="194" text-anchor="middle" font-size="11" fill="var(--warn)">reconciliation</text>

    <rect x="312" y="248" width="204" height="44" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="414" y="268" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">Vault</text>
    <text x="414" y="284" text-anchor="middle" font-size="11" fill="var(--muted)">platform key</text>
  </g>
  <path d="M414,212 L414,248" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l2a)"/>
  <text x="424" y="234" font-size="11" fill="var(--muted)">reads its key</text>

  <!-- cloud -->
  <g>
    <rect x="616" y="76" width="232" height="60" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="630" y="92" font-size="9" letter-spacing="0.08em" fill="var(--faint)">NAMESPACE</text>
    <text x="732" y="111" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">ws-control</text>
    <text x="732" y="128" text-anchor="middle" font-size="11" fill="var(--muted)">made by hand</text>

    <rect x="616" y="220" width="232" height="60" rx="6" fill="none"
          stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="630" y="236" font-size="9" letter-spacing="0.08em" fill="var(--faint)">NAMESPACE</text>
    <text x="732" y="255" text-anchor="middle" font-size="13" fill="var(--warn)" font-family="var(--mono)">ws-orders-staging</text>
    <text x="732" y="272" text-anchor="middle" font-size="11" fill="var(--warn)">does not exist yet</text>
  </g>

  <!-- tpctl -> control: level, in the clear band, crossing nothing -->
  <path d="M212,98 L616,98" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l2a)"/>
  <text x="414" y="90" text-anchor="middle" font-size="11" fill="var(--muted)">starts ProvisionWorkflow</text>

  <!-- worker -> control -->
  <path d="M516,170 C566,170 574,124 616,124" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l2a)"/>
  <text x="566" y="142" text-anchor="middle" font-size="11" fill="var(--muted)">polls</text>

  <!-- worker -> the namespace it cannot make yet -->
  <path d="M516,196 C566,196 574,250 616,250" stroke="var(--warn)" stroke-width="1.5"
        stroke-dasharray="5 4" fill="none" marker-end="url(#l2b)"/>
  <text x="524" y="186" font-size="11" fill="var(--warn)">apply + mint</text>

  <text x="8" y="334" font-size="11" fill="var(--warn)">dotted yellow = what this challenge adds</text>
</svg>`;

/**
 * Challenge 1's shape: the bootstrap paradox, drawn.
 *
 * The zones sit at the same x-positions in every diagram here, so a student who
 * has read one reads the rest without relearning the frame. Challenge 1 earns the
 * top band for `terraform apply` -> the namespace it creates, which is the edge
 * the whole challenge exists to draw.
 *
 * Two things are deliberately given visual weight over everything else. The
 * namespace is dashed because it does not exist yet -- it is the output, not the
 * setting. And the long return arrow along the bottom is the point of the
 * challenge: the same module, run by a workflow from challenge 2 on. Without it
 * the picture says "you ran Terraform", which is not the lesson.
 */
export const LAB1_SVG = `<svg viewBox="0 0 880 348" role="img"
     aria-label="You create a service account and API key in the Cloud UI and paste the key into Vault. Vault hands the key to a single terraform apply on your laptop, which runs the module you wrote and creates the ws-control namespace. From challenge 2 on, a workflow runs that same module."
     xmlns="http://www.w3.org/2000/svg" font-family="inherit">
  <defs>
    <marker id="l1a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--faint)"/>
    </marker>
    <marker id="l1b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--warn)"/>
    </marker>
  </defs>

  <!-- zones -->
  <g fill="none" stroke="var(--rule)" stroke-width="1">
    <rect x="8"   y="44" width="236" height="256" rx="8"/>
    <rect x="316" y="44" width="180" height="256" rx="8"/>
    <rect x="548" y="44" width="324" height="256" rx="8"/>
  </g>
  <g font-size="12" fill="var(--muted)" letter-spacing="0.06em">
    <text x="22"  y="34">YOUR LAPTOP</text>
    <text x="330" y="34">KUBERNETES</text>
    <text x="562" y="34">TEMPORAL CLOUD</text>
  </g>

  <!-- laptop: apply on the top band, so its edge to the cloud runs level -->
  <g>
    <rect x="32" y="76" width="180" height="44" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="122" y="103" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">terraform apply</text>

    <rect x="32" y="210" width="180" height="52" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="122" y="233" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">terraform/namespace</text>
    <text x="122" y="250" text-anchor="middle" font-size="11" fill="var(--muted)">the module you write</text>
  </g>
  <path d="M122,210 L122,126" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l1a)"/>

  <!-- vault, in the lower band so it never sits under the top edge -->
  <g>
    <rect x="336" y="210" width="140" height="52" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="406" y="233" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">Vault</text>
    <text x="406" y="250" text-anchor="middle" font-size="11" fill="var(--muted)">the platform key</text>
  </g>
  <path d="M406,210 L406,180 L122,180 L122,132" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l1a)"/>
  <text x="264" y="172" text-anchor="middle" font-size="11" fill="var(--muted)">the key, for one command</text>

  <!-- cloud -->
  <g>
    <rect x="572" y="76" width="276" height="60" rx="6" fill="none"
          stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="586" y="92" font-size="9" letter-spacing="0.08em" fill="var(--faint)">NAMESPACE</text>
    <text x="710" y="111" text-anchor="middle" font-size="13" fill="var(--warn)" font-family="var(--mono)">ws-control</text>
    <text x="710" y="128" text-anchor="middle" font-size="11" fill="var(--warn)">this apply creates it</text>

    <rect x="572" y="210" width="276" height="52" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="710" y="233" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">platform</text>
    <text x="710" y="250" text-anchor="middle" font-size="11" fill="var(--muted)">Service Account · made in the UI</text>
  </g>
  <path d="M572,236 L482,236" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l1a)"/>
  <text x="527" y="228" text-anchor="middle" font-size="11" fill="var(--muted)">pasted once</text>

  <!-- the edge the challenge is about: your module, your apply, a namespace -->
  <path d="M212,98 L566,98" stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5" fill="none" marker-end="url(#l1b)"/>
  <text x="389" y="90" text-anchor="middle" font-size="11" fill="var(--warn)">creates it, by hand, once</text>

  <!-- and the reason once is enough -->
  <path d="M848,106 L864,106 L864,326 L18,326 L18,236 L26,236"
        stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="4 4" fill="none" marker-end="url(#l1a)"/>
  <text x="441" y="318" text-anchor="middle" font-size="11" fill="var(--muted)">from challenge 2 on, a workflow runs this same module</text>
</svg>`;

/**
 * Challenge 3's news: two inputs of different kinds, feeding one loop.
 *
 * Everything challenge 2 drew is still here and still faint -- the worker, the
 * namespace, the apply. What is new is in yellow: the signal path, the loop
 * itself, and the timer that goes and looks. The lab says "intent arrives by
 * signal, reality arrives by timer" in prose; this is that sentence with the
 * arrows drawn, which is why reading and writing are two edges rather than one
 * double-headed line -- they are not the same event and they do not leave from
 * the same box.
 *
 * The hand edit is routed along the BOTTOM, outside every zone, on purpose. It is
 * the one arrow that touches the namespace without passing through the platform,
 * and drawing it going around is the entire argument for having a timer at all.
 * An earlier version ran it straight through the Kubernetes zone, which drew the
 * opposite: that the platform was somehow involved in it.
 */
export const LAB3_SVG = `<svg viewBox="0 0 880 372" role="img"
     aria-label="tpctl sync signals a long-lived ns-orders workflow, which the platform worker polls and executes. On a timer the loop inspects your namespace, and the worker runs the activity that puts retention back. Separately, you edit retention by hand in the Cloud UI, which reaches the namespace without passing through the platform at all."
     xmlns="http://www.w3.org/2000/svg" font-family="inherit">
  <defs>
    <marker id="l3a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--faint)"/>
    </marker>
    <marker id="l3b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--warn)"/>
    </marker>
    <marker id="l3c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--fail)"/>
    </marker>
  </defs>

  <!-- zones -->
  <g fill="none" stroke="var(--rule)" stroke-width="1">
    <rect x="8"   y="44" width="236" height="256" rx="8"/>
    <rect x="288" y="44" width="252" height="256" rx="8"/>
    <rect x="592" y="44" width="280" height="256" rx="8"/>
  </g>
  <g font-size="12" fill="var(--muted)" letter-spacing="0.06em">
    <text x="22"  y="34">YOUR LAPTOP</text>
    <text x="302" y="34">KUBERNETES</text>
    <text x="606" y="34">TEMPORAL CLOUD</text>
  </g>

  <!-- laptop -->
  <g>
    <rect x="32" y="76" width="180" height="44" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="122" y="103" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">tpctl sync</text>

    <rect x="32" y="170" width="180" height="52" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="122" y="193" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">specs/orders.yaml</text>
    <text x="122" y="210" text-anchor="middle" font-size="11" fill="var(--muted)">retention 7</text>

    <rect x="32" y="244" width="180" height="48" rx="6" fill="var(--surface-table)" stroke="var(--fail)"/>
    <text x="122" y="265" text-anchor="middle" font-size="13" fill="var(--ink)">Cloud UI</text>
    <text x="122" y="282" text-anchor="middle" font-size="11" fill="var(--fail)">you, by hand</text>
  </g>
  <path d="M122,170 L122,126" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l3a)"/>

  <!-- kubernetes -->
  <g>
    <rect x="312" y="152" width="204" height="60" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="414" y="175" text-anchor="middle" font-size="13" fill="var(--ink)">Platform Temporal Worker</text>
    <text x="414" y="194" text-anchor="middle" font-size="11" fill="var(--warn)">executes the loop</text>
  </g>

  <!-- cloud: the loop, and the namespace it is responsible for -->
  <g>
    <rect x="616" y="76" width="232" height="60" rx="6" fill="none"
          stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="630" y="92" font-size="9" letter-spacing="0.08em" fill="var(--faint)">WORKFLOW</text>
    <text x="732" y="111" text-anchor="middle" font-size="13" fill="var(--warn)" font-family="var(--mono)">ns-orders</text>
    <text x="732" y="128" text-anchor="middle" font-size="11" fill="var(--warn)">the loop · one per spec, forever</text>

    <rect x="616" y="224" width="232" height="60" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="630" y="240" font-size="9" letter-spacing="0.08em" fill="var(--faint)">NAMESPACE</text>
    <text x="732" y="259" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">ws-orders-staging</text>
    <text x="732" y="276" text-anchor="middle" font-size="11" fill="var(--muted)">retention 7</text>
  </g>

  <!-- intent: by signal -->
  <path d="M212,98 L610,98" stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5" fill="none" marker-end="url(#l3b)"/>
  <text x="411" y="90" text-anchor="middle" font-size="11" fill="var(--warn)">signal-with-start</text>

  <path d="M516,170 C566,170 574,126 616,126" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l3a)"/>
  <text x="566" y="142" text-anchor="middle" font-size="11" fill="var(--muted)">polls</text>

  <!-- reality, back up to the loop -->
  <path d="M732,224 L732,142" stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5" fill="none" marker-end="url(#l3b)"/>
  <text x="740" y="188" text-anchor="start" font-size="11" fill="var(--warn)">Inspect · every 2 min</text>

  <!-- and the correction, back down. drawn from the WORKER rather than from the
       workflow, because that is where it comes from: ns-orders decides, and the
       worker runs the Terraform activity that puts retention back. A student who
       reads this edge as leaving the workflow box has learned the wrong thing
       about where the work in a Temporal application actually happens. -->
  <path d="M414,212 L414,254 L610,254" stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5" fill="none" marker-end="url(#l3b)"/>
  <text x="528" y="246" text-anchor="middle" font-size="11" fill="var(--warn)">apply · puts it back</text>

  <!-- reality: by nobody. this is why the timer exists -->
  <path d="M122,292 L122,330 L732,330 L732,290" stroke="var(--fail)" stroke-width="1.5" fill="none" marker-end="url(#l3c)"/>
  <text x="427" y="322" text-anchor="middle" font-size="11" fill="var(--fail)">retention 7 → 30, nothing signalled</text>

  <text x="8" y="360" font-size="11" fill="var(--muted)">the timer is the new half — nobody signals a platform when somebody edits by hand</text>
</svg>`;

/**
 * Challenge 4, from the product team's side: one value, travelling.
 *
 * `orders-main` is written once, in a decorator, and every other place it appears
 * is generated from that. So it is the only string in yellow, in both places
 * it lands -- if a student takes one thing from this picture it should be that
 * they typed the task queue in Python and it turned into the queue a pod in
 * Kubernetes is polling.
 *
 * The namespace is drawn as a CONTAINER rather than as a third box in the stack.
 * An earlier version had ws-orders-staging, orders-main and GreetingWorkflow as
 * three peers, which read as three Cloud entities of the same kind. They are not:
 * the namespace is the only thing Temporal Cloud shows you at that level, and the
 * queue and the execution live inside it.
 *
 * The credential is drawn as two short labels on one arrow rather than as a
 * ServiceAccount box, which an earlier version had. The box was accurate and made
 * the diagram about Kubernetes RBAC; the arrow says the same thing -- the pod
 * proves who it is and is handed a key nobody typed -- in the space of a label.
 */
export const LAB4_SVG = `<svg viewBox="0 0 880 372" role="img"
     aria-label="A decorator in greeting.py declares the task queue orders-main. tpctl deploy reads it, builds an image and deploys a worker into its own Kubernetes namespace. The pod proves its identity to Vault and gets a key nobody typed, then polls the orders-main task queue inside your ws-orders-staging namespace. You start GreetingWorkflow yourself and it completes there."
     xmlns="http://www.w3.org/2000/svg" font-family="inherit">
  <defs>
    <marker id="l4a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--faint)"/>
    </marker>
    <marker id="l4b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--warn)"/>
    </marker>
  </defs>

  <!-- zones -->
  <g fill="none" stroke="var(--rule)" stroke-width="1">
    <rect x="8"   y="44" width="236" height="256" rx="8"/>
    <rect x="288" y="44" width="252" height="256" rx="8"/>
    <rect x="592" y="44" width="280" height="256" rx="8"/>
  </g>
  <g font-size="12" fill="var(--muted)" letter-spacing="0.06em">
    <text x="22"  y="34">YOUR LAPTOP</text>
    <text x="302" y="34">KUBERNETES</text>
    <text x="606" y="34">TEMPORAL CLOUD</text>
  </g>

  <!-- laptop: the one file you write, and the one command you run -->
  <g>
    <rect x="32" y="76" width="180" height="60" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="122" y="99" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">greeting.py</text>
    <text x="122" y="118" text-anchor="middle" font-size="11" fill="var(--warn)" font-family="var(--mono)">task_queue orders-main</text>

    <rect x="32" y="182" width="180" height="52" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="122" y="205" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">tpctl deploy</text>
    <text x="122" y="222" text-anchor="middle" font-size="11" fill="var(--muted)">reads the decorator</text>

    <rect x="32" y="252" width="180" height="40" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="122" y="277" text-anchor="middle" font-size="11" fill="var(--ink)" font-family="var(--mono)">temporal workflow execute</text>
  </g>
  <path d="M122,136 L122,176" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l4a)"/>

  <!-- kubernetes: a namespace of its own, and the secret it fetches for itself -->
  <rect x="304" y="70" width="220" height="100" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="3 3"/>
  <text x="314" y="88" font-size="11" fill="var(--muted)" font-family="var(--mono)">ns worker-orders</text>
  <g>
    <rect x="320" y="100" width="188" height="60" rx="6" fill="none"
          stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5"/>
    <text x="414" y="123" text-anchor="middle" font-size="13" fill="var(--warn)" font-family="var(--mono)">orders-worker</text>
    <text x="414" y="142" text-anchor="middle" font-size="11" fill="var(--warn)">Deployment · your image</text>

    <rect x="320" y="236" width="188" height="52" rx="6" fill="var(--surface-table)" stroke="var(--rule-strong)"/>
    <text x="414" y="259" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="var(--mono)">Vault</text>
    <text x="414" y="276" text-anchor="middle" font-size="11" fill="var(--muted)">the namespace's key</text>
  </g>
  <path d="M414,160 L414,230" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l4a)"/>
  <text x="424" y="192" font-size="11" fill="var(--muted)">proves who it is</text>
  <text x="424" y="212" font-size="11" fill="var(--muted)">gets the key</text>

  <path d="M212,208 L298,208" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l4a)"/>
  <text x="255" y="200" text-anchor="middle" font-size="11" fill="var(--muted)">deploys</text>

  <!-- cloud: the namespace is the container, not a peer of what is inside it -->
  <rect x="604" y="70" width="256" height="222" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="3 3"/>
  <text x="614" y="88" font-size="9" letter-spacing="0.08em" fill="var(--faint)">NAMESPACE</text>
  <text x="696" y="88" font-size="11" fill="var(--muted)" font-family="var(--mono)">ws-orders-staging</text>
  <g>
    <rect x="620" y="104" width="224" height="52" rx="6" fill="none"
          stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5"/>
    <text x="732" y="127" text-anchor="middle" font-size="13" fill="var(--warn)" font-family="var(--mono)">orders-main</text>
    <text x="732" y="144" text-anchor="middle" font-size="11" fill="var(--warn)">task queue</text>

    <rect x="620" y="204" width="224" height="52" rx="6" fill="none"
          stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5"/>
    <text x="732" y="227" text-anchor="middle" font-size="13" fill="var(--warn)" font-family="var(--mono)">GreetingWorkflow</text>
    <text x="732" y="244" text-anchor="middle" font-size="11" fill="var(--pass)">completed</text>
  </g>
  <path d="M732,156 L732,198" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l4a)"/>
  <text x="740" y="182" font-size="11" fill="var(--muted)">runs on it</text>

  <!-- the queue the decorator named is the queue the pod polls -->
  <path d="M508,130 L614,130" stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5" fill="none" marker-end="url(#l4b)"/>
  <text x="561" y="122" text-anchor="middle" font-size="11" fill="var(--warn)">polls</text>

  <!-- and you, as the caller -->
  <path d="M122,292 L122,330 L732,330 L732,262" stroke="var(--faint)" stroke-width="1.5" fill="none" marker-end="url(#l4a)"/>
  <text x="427" y="322" text-anchor="middle" font-size="11" fill="var(--muted)">you, as the caller — the only step that proves the worker works</text>

  <text x="8" y="360" font-size="11" fill="var(--warn)">one value, written once in a decorator: the config, the manifest and the queue are all generated from it</text>
</svg>`;
