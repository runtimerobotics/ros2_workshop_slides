"""Regenerate the deck's animated SVG diagrams and write them into index.html.

Usage (from the repository root):
    python3 tools/animations/build.py          # update index.html in place
    python3 tools/animations/build.py --check  # exit 1 if index.html is out of date

Each generated slide is matched by its data-title. Whole slides are replaced for the
slides this script owns; for a few hand-written slides only the diagram is replaced.
Edit the slide definitions below, run the script, then review the diff.
"""
import re
import sys
from pathlib import Path


def vis(start, end, dur):
    # Discrete opacity: visible between start and end fractions of the cycle.
    if end >= 1:
        return f'<animate attributeName="opacity" dur="{dur}" repeatCount="indefinite" calcMode="discrete" values="0;1" keyTimes="0;{start}"/>'
    if start <= 0:
        return f'<animate attributeName="opacity" dur="{dur}" repeatCount="indefinite" calcMode="discrete" values="1;0" keyTimes="0;{end}"/>'
    return f'<animate attributeName="opacity" dur="{dur}" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;{start};{end}"/>'

EASE = "0.45 0 0.2 1"

def packet(cls, path, start, end, dur):
    # Eased travel: wait, glide with ease-in-out, then hold hidden.
    if start <= 0:
        kt, kp, ks = f"0;{end};1", "0;1;1", f"{EASE};0 0 1 1"
    else:
        kt, kp, ks = f"0;{start};{end};1", "0;0;1;1", f"0 0 1 1;{EASE};0 0 1 1"
    return (f'<g class="packet"><rect class="{cls}" x="-11" y="-11" width="22" height="22" rx="5"/>'
            f'<animateMotion dur="{dur}" repeatCount="indefinite" calcMode="spline" keySplines="{ks}" path="{path}" keyPoints="{kp}" keyTimes="{kt}"/>'
            f'{vis(start, end, dur)}</g>')

def flash(x, y, w, h, t, dur, rx=6):
    # Outline that lights up when a packet arrives at a box.
    t = max(t, .002); a = min(t + .005, .997); b = min(t + .07, .999)
    return (f'<rect class="flash" x="{x - 3}" y="{y - 3}" width="{w + 6}" height="{h + 6}" rx="{rx + 2}" opacity="0">'
            f'<animate attributeName="opacity" dur="{dur}" repeatCount="indefinite" values="0;0;1;0;0" keyTimes="0;{t};{a};{b};1"/></rect>')

_ids = [0]
def typed(x, y, text, start, dur, frac=.04, end=None, cls="code"):
    # Text that types itself in by widening a clip rectangle.
    import html
    _ids[0] += 1; cid = f"tc{_ids[0]}"
    w = len(html.unescape(text)) * 7.9 + 8
    s = max(start, .003); e = min(s + frac, .996)
    hide = vis(s, end, dur) if end else ""
    return (f'<clipPath id="{cid}"><rect x="{x - 2}" y="{y - 11}" height="22" width="0">'
            f'<animate attributeName="width" dur="{dur}" repeatCount="indefinite" values="0;0;{w:.0f};{w:.0f}" keyTimes="0;{s};{e};1"/></rect></clipPath>'
            f'<text class="{cls}" x="{x}" y="{y}" clip-path="url(#{cid})">{text}{hide}</text>')

def shown(x, y, text, start, dur, end=1, cls="code"):
    return f'<text class="{cls}" x="{x}" y="{y}" opacity="0">{text}{vis(start, end, dur)}</text>'

def term(x, y, w, h, title):
    return (f'<rect class="term" x="{x}" y="{y}" width="{w}" height="{h}" rx="6"/>'
            f'<rect class="termbar" x="{x}" y="{y}" width="{w}" height="22" rx="6"/>'
            + "".join(f'<circle class="dot{i}" cx="{x + 14 + i * 13}" cy="{y + 11}" r="4"/>' for i in range(3))
            + f'<text class="k" x="{x + w / 2}" y="{y + 12}">{title}</text>')

WORLD = 11.0889
def win(x, y, s, title="TurtleSim", bg_anim=""):
    return (f'<rect class="termbar" x="{x}" y="{y - 22}" width="{s}" height="24" rx="5"/><text class="k" x="{x + s / 2}" y="{y - 10}">{title}</text>'
            f'<rect class="win" x="{x}" y="{y}" width="{s}" height="{s}" fill="#4556ff">{bg_anim}</rect>')

def wpt(x, y, s, wx, wy):
    # turtlesim world metres (origin bottom-left, 11.09 m wide) to SVG pixels
    return round(x + wx * s / WORLD, 1), round(y + (WORLD - wy) * s / WORLD, 1)

TURTLE = ('<g class="turtle"><circle cx="-2" cy="-9" r="3"/><circle cx="-2" cy="9" r="3"/><circle cx="7" cy="-8" r="3"/><circle cx="7" cy="8" r="3"/>'
          '<circle cx="13" r="4.5"/><ellipse rx="11" ry="9" class="shell"/></g>')

def drive(path, start, end, dur, pen="pen"):
    # Turtle that drives along path between start and end, drawing a pen trail behind it.
    kt = f"0;{max(start, .002)};{end};1"
    return (f'<path class="{pen}" d="{path}" pathLength="1" stroke-dasharray="1 1"><animate attributeName="stroke-dashoffset" dur="{dur}" repeatCount="indefinite" values="1;1;0;0" keyTimes="{kt}"/></path>'
            f'<g>{TURTLE}<animateMotion dur="{dur}" repeatCount="indefinite" rotate="auto" calcMode="linear" path="{path}" keyPoints="0;0;1;1" keyTimes="{kt}"/></g>')

def cap(text, start, end, dur, x=450, y=0):
    return f'<text class="cap" x="{x}" y="{y}" opacity="0">{text}{vis(start, end, dur)}</text>'

def node(x, y, w, h, kind, name, cls="node"):
    rx = h / 2 if "pill" in cls else 6
    cx = x + w / 2
    return (f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>'
            f'<text class="k" x="{cx}" y="{y + h / 2 - 11}">{kind}</text><text class="s" x="{cx}" y="{y + h / 2 + 10}">{name}</text>')

def wire(d):
    return f'<path class="wire" d="{d}"/>'

def svg(vb_h, label, body, extra_cls="", vb_w=900):
    return (f'      <svg class="ros-anim{extra_cls}" viewBox="0 0 {vb_w} {vb_h}" role="img" aria-label="{label}">\n        '
            + body + '\n      </svg>\n')

def slide(section, title, eyebrow, head, inner, notes, extra=""):
    return (f'    <section class="slide" data-section="{section}" data-title="{title}">\n'
            f'      <div class="slide-head"><p class="eyebrow">{eyebrow}</p><h2>{head}</h2></div>\n'
            f'{inner}{extra}      <aside class="notes">{notes}</aside>\n    </section>\n\n')

def legend(*items):
    return '      <div class="anim-legend">' + "".join(f'<span><i class="{c}"></i>{t}</span>' for c, t in items) + '</div>\n'

def grid(*items):
    return '      <div class="compact-grid">' + "".join(f'<p><strong>{a}</strong><br>{b}</p>' for a, b in items) + '</div>\n'

def hub(center_kind, center_name, items, dur, out_cls, back_cls=None):
    """Center circle with six boxes; a packet visits each box in turn, with a caption per box."""
    pos = [(20, 30), (20, 125), (20, 220), (680, 30), (680, 125), (680, 220)]
    body = []
    for (x, y), _ in zip(pos, items):
        ex = x + 200 if x < 450 else x
        body.append(wire(f"M450,155 L{ex},{y + 30}"))
    body.append('<circle class="hub" cx="450" cy="155" r="72"/>'
                f'<circle class="ring" cx="450" cy="155" r="72"><animate attributeName="r" dur="2s" repeatCount="indefinite" values="72;96"/><animate attributeName="opacity" dur="2s" repeatCount="indefinite" values=".6;0"/></circle>'
                f'<text class="k" x="450" y="143">{center_kind}</text><text class="s" x="450" y="166">{center_name}</text>')
    slot = 1 / len(items)
    for i, ((x, y), (kind, name, caption)) in enumerate(zip(pos, items)):
        body.append(node(x, y, 200, 60, kind, name))
        ex = x + 200 if x < 450 else x
        s = round(i * slot + 0.01, 3)
        if back_cls:
            mid = round(s + slot * 0.45, 3)
            body.append(packet(out_cls, f"M450,155 L{ex},{y + 30}", s, mid, dur) + flash(x, y, 200, 60, mid, dur))
            body.append(packet(back_cls, f"M{ex},{y + 30} L450,155", mid + 0.01, round(s + slot * 0.9, 3), dur))
        else:
            body.append(packet(out_cls, f"M450,155 L{ex},{y + 30}", s, round(s + slot * 0.8, 3), dur) + flash(x, y, 200, 60, round(s + slot * 0.8, 3), dur))
        body.append(cap(caption, round(i * slot, 3), round((i + 1) * slot, 3) if i < len(items) - 1 else 1, dur, 450, 306))
    return "".join(body)

OV = "Welcome · ROS 2 overview"
out = {}

# ---------- ROS 2 equation: one animated slide per term ----------
d = "8s"
img = "M200,70 L360,70"; obj = "M540,70 L700,70"
srv = "M700,95 C620,95 620,215 540,215"; srv_r = "M540,215 C620,215 620,95 700,95"
act = "M790,105 L790,180"; act_r = "M790,180 L790,105"
body = [wire(img), wire(obj), wire(srv), wire(act),
        '<text class="k" x="280" y="55">/image · topic</text><text class="k" x="620" y="55">/objects · topic</text>',
        '<text class="k" x="620" y="245">/get_map · service</text><text class="k" x="845" y="143">/move_arm</text><text class="k" x="845" y="158">action</text>',
        node(20, 35, 180, 70, "node", "/camera"), node(360, 35, 180, 70, "node", "/detector"), node(700, 35, 180, 70, "node", "/planner"),
        node(360, 180, 180, 70, "node", "/map_server"), node(700, 180, 180, 70, "node", "/arm_controller")]
for s in (0, .2, .4, .6):
    body.append(packet("req", img, s, s + .15, d) + flash(360, 35, 180, 70, s + .15, d))
for s in (.1, .3, .5, .7):
    body.append(packet("req", obj, s, s + .15, d) + flash(700, 35, 180, 70, s + .15, d))
body += [flash(360, 180, 180, 70, .3, d), flash(700, 180, 180, 70, .56, d), flash(700, 35, 180, 70, .93, d),
         packet("req", srv, .16, .3, d), packet("res", srv_r, .32, .46, d),
         packet("req", act, .48, .56, d), packet("fb", act_r, .6, .68, d), packet("fb", act_r, .71, .79, d), packet("res", act_r, .84, .93, d)]
out["plumbing"] = slide(OV, "Plumbing: how programs talk", "ROS 2 equation · 1 of 4", "Plumbing: how programs talk",
    svg(260, "Five nodes exchange data: camera images and detected objects flow on topics, the planner calls a map service, and sends an action goal to the arm controller which returns feedback and a result", "".join(body))
    + legend(("req", "message / request"), ("res", "response / result"), ("fb", "feedback"))
    + grid(("Discovery", "nodes find each other"), ("Interfaces", "typed messages on the wire"), ("QoS", "delivery and history rules"), ("Executors", "run callbacks when data arrives")),
    "This one picture uses all three patterns from Day 1: topics for streams, a service for a quick question, and an action for a long task. Plumbing is everything that moves those messages.")

d = "9s"
out["tools"] = slide(OV, "Tools: see inside the system", "ROS 2 equation · 2 of 4", "Tools: see inside the system",
    svg(320, "A running ROS 2 system in the centre sends data to six tools in turn: the ros2 CLI, RViz2, rqt, ros2 bag, launch, and Gazebo",
        hub("running", "ROS 2 graph", [
            ("inspect", "ros2 CLI", "ros2 topic echo /scan"),
            ("visualize", "RViz2", "rviz2"),
            ("plot + GUIs", "rqt", "rqt_graph"),
            ("record", "ros2 bag", "ros2 bag record -a"),
            ("start", "launch", "ros2 launch my_pkg robot.launch.py"),
            ("simulate", "Gazebo", "ros2 launch ros_gz_sim gz_sim.launch.py"),
        ], d, "req"))
    + '      <p class="takeaway">The same tools work on every ROS 2 robot, because every robot speaks the same graph.</p>\n',
    "Each tool is just another node, or a client of the graph. That is why a tool written for one robot works on yours with no changes.")

d = "8s"
layers = [  # (x, y, w, kind, name, cls, appear)
    (100, 240, 700, "drivers", "Hardware · cameras · lidars · motors", "block", .05),
    (100, 185, 340, "control", "ros2_control", "block", .18),
    (460, 185, 340, "geometry", "TF2 + robot_state_publisher", "block", .26),
    (100, 130, 220, "navigation", "Nav2", "block", .38),
    (340, 130, 220, "manipulation", "MoveIt 2", "block", .46),
    (580, 130, 220, "perception", "SLAM · image_pipeline", "block", .54),
    (100, 50, 700, "what you write", "Your application", "block app", .68),
]
body = []
for x, y, w, kind, name, cls, t in layers:
    body.append(f'<g opacity="0">{node(x, y, w, 46 if "app" not in cls else 60, kind, name, cls)}'
                f'<animateTransform attributeName="transform" type="translate" dur="{d}" repeatCount="indefinite" values="0 -26;0 -26;0 0;0 0" keyTimes="0;{t};{round(t + .06, 3)};1"/>'
                f'<animate attributeName="opacity" dur="{d}" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;{t};.95"/></g>')
out["capabilities"] = slide(OV, "Capabilities: do not start from zero", "ROS 2 equation · 3 of 4", "Capabilities: do not start from zero",
    svg(300, "Blocks stack up: hardware drivers, then ros2_control and TF2, then Nav2, MoveIt 2 and perception, and finally your application on top", "".join(body))
    + '      <p class="takeaway">Reuse tested packages for the common parts. Write only what makes your robot different.</p>\n',
    "Ask participants which block their own project lives in. Most real robots use several of these packages unchanged. Day 3 uses ros2_control and MoveIt 2 directly.")

d = "12s"
out["community"] = slide(OV, "Community: you are not alone", "ROS 2 equation · 4 of 4", "Community: you are not alone",
    svg(320, "You ask a question or look for something and get an answer back from six community resources in turn: docs, Robotics Stack Exchange, ROS Discourse, the package index, ROSCon, and GitHub",
        hub("you", "ROS developer", [
            ("learn", "docs.ros.org", "tutorials and concepts for your distro"),
            ("ask", "robotics.stackexchange.com", "search before you ask a question"),
            ("discuss", "discourse.openrobotics.org", "news, releases, and design talks"),
            ("find packages", "index.ros.org", "reuse a package before writing one"),
            ("meet", "ROSCon + meetups", "talks and videos from real projects"),
            ("contribute", "github.com/ros2", "issues, pull requests, reviews"),
        ], d, "req", "res"))
    + '      <p class="takeaway">Thousands of developers, companies, and universities maintain ROS 2 together, in the open.</p>\n',
    "Show participants how to search an error message on Robotics Stack Exchange and how to check that a package supports Jazzy on index.ros.org.")

# ---------- Client libraries ----------
d = "6s"
L = [("your node", "talker.py", "node"), ("client library", "rclpy · Python", "node pill"), ("shared core", "rcl · C", "sub"), ("middleware API", "rmw", "sub"), ("transport", "DDS", "sub")]
R = [("your node", "listener · C++", "node"), ("client library", "rclcpp · C++", "node pill"), ("shared core", "rcl · C", "sub"), ("middleware API", "rmw", "sub"), ("transport", "DDS", "sub")]
body = []
for col_x, col in ((40, L), (600, R)):
    for i, (kind, name, cls) in enumerate(col):
        body.append(node(col_x, 10 + i * 56, 260, 46, kind, name, cls))
body.append(wire("M300,257 L600,257") + '<text class="k" x="450" y="244">network · RTPS</text>')
path = "M170,33 L170,257 L730,257 L730,33"
body += [packet("req", path, 0, .62, d),
         # path legs are 224 down, 560 across, 224 up over 0..0.62 of the cycle
         cap("Python: rclpy → rcl → rmw", 0, .14, d, 450, 110), cap("DDS carries it across", .14, .48, d, 450, 110),
         cap("C++: rmw → rcl → rclcpp", .48, .62, d, 450, 110), cap("same message, any language", .62, 1, d, 450, 110)]
out["clientlibs"] = slide("Day 1 · Architecture", "ROS 2 client libraries", "rcl · rclcpp · rclpy", "ROS 2 client libraries",
    svg(280, "A message from a Python node goes down through rclpy, rcl, rmw and DDS, across the network, and up through rcl and rclcpp into a C++ node", "".join(body))
    + grid(("rclcpp · C++", "drivers, control loops, speed"), ("rclpy · Python", "tools, prototypes, scripts"), ("rclc · C", "microcontrollers with micro-ROS"), ("Community", "rclrs (Rust), rclnodejs (JS), and more")),
    "rclcpp and rclpy are the two officially supported libraries. Both are thin layers over the same C library, rcl, so behavior is consistent and a Python node talks to a C++ node with no extra work.")

# ---------- TF2 ----------
loop = "M250,200 C330,80 620,60 720,150 C800,230 560,280 400,250 C320,235 260,240 250,200 Z"
robot = ('<rect class="robot" x="-45" y="-28" width="90" height="56" rx="10"/>'
         '<line class="ax-x" x1="0" y1="0" x2="42" y2="0"/><line class="ax-y" x1="0" y1="0" x2="0" y2="-42"/>'
         '<circle class="lidar" cx="26" cy="14" r="9"/><line class="ax-x thin" x1="26" y1="14" x2="46" y2="14"/><line class="ax-y thin" x1="26" y1="14" x2="26" y2="-6"/>'
         '<text class="k" x="-4" y="44">base_link</text><text class="k" x="46" y="34">lidar_link</text>'
         '<animateMotion dur="12s" repeatCount="indefinite" rotate="auto" path="' + loop + '"/>')
body = [f'<path class="trail" d="{loop}"/>',
        '<line class="ax-x" x1="70" y1="270" x2="130" y2="270"/><line class="ax-y" x1="70" y1="270" x2="70" y2="210"/><text class="k" x="70" y="290">map</text>',
        '<text class="k" x="140" y="275">x</text><text class="k" x="70" y="200">y</text>',
        f'<g>{robot}</g>']
# ---------- URDF: animated arm replaces the static chain ----------
d = "6s"
arm = (f'<rect class="node" x="210" y="250" width="180" height="40" rx="6"/><text class="s" x="300" y="270">base_link</text>'
       f'<g><animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" values="-35 300 250;35 300 250;-35 300 250"/>'
       '<rect class="arm" x="290" y="130" width="20" height="120" rx="10"/><text class="k left" x="318" y="195">link_1</text>'
       f'<g><animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" values="60 300 130;-20 300 130;60 300 130"/>'
       '<rect class="arm" x="292" y="35" width="16" height="95" rx="8"/><text class="k left" x="316" y="85">link_2</text>'
       '<line class="ax-x" x1="300" y1="35" x2="330" y2="35"/><line class="ax-y" x1="300" y1="35" x2="300" y2="5"/><text class="k left" x="334" y="30">tool0</text>'
       '<circle class="joint" cx="300" cy="130" r="9"/><text class="k left" x="316" y="140">joint2</text></g></g>'
       '<circle class="joint" cx="300" cy="250" r="10"/><text class="k left" x="316" y="242">joint1</text>')
code = ['&lt;joint name="joint1" type="revolute"&gt;', '  &lt;parent link="base_link"/&gt;', '  &lt;child link="link_1"/&gt;',
        '  &lt;origin xyz="0 0 0.05"/&gt;', '  &lt;axis xyz="0 0 1"/&gt;', '  &lt;limit lower="-0.61" upper="0.61"', '         effort="10" velocity="1.0"/&gt;', '&lt;/joint&gt;']
code_svg = '<rect class="sub" x="480" y="40" width="400" height="230" rx="6"/>' + "".join(f'<text class="code" x="500" y="{75 + i * 24}">{line}</text>' for i, line in enumerate(code))
urdf_svg = svg(300, "A two-link arm: joint1 and joint2 rotate, moving link_1, link_2 and the tool0 frame, next to the URDF joint that describes joint1", arm + code_svg)


# ---------- Gazebo: animated simulation loop ----------
ring = "M450,45 A300,105 0 0,1 750,150 A300,105 0 0,1 450,255 A300,105 0 0,1 150,150 A300,105 0 0,1 450,45"
boxes = [(450, 45, "world", "World + robot"), (750, 150, "physics step", "Forces + contacts"), (450, 255, "sensors", "Sample the world"), (150, 150, "controllers", "Apply commands")]
g = [f'<path class="wire" d="{ring}"/>'] + [node(x - 100, y - 28, 200, 56, k, n) for x, y, k, n in boxes]
g.append('<g class="packet"><circle class="pulse" r="10"/><animateMotion dur="2s" repeatCount="indefinite" path="' + ring + '"/></g>')
g.append('<text class="k" x="450" y="138">/clock · sim time</text>')
for i in range(4):
    g.append(f'<text class="s hot" x="450" y="164" opacity="0">{(i + 1) / 1000:.3f} s{vis(i / 4, (i + 1) / 4 if i < 3 else 1, "8s")}</text>')
gz_svg = svg(300, "The simulation loop: world, physics step, sensors, controllers, and back to the world; each lap advances /clock by one 1 ms step", "".join(g))


Q = "&quot;"

def ring(cx, cy, t0, t1, dur, r0=28, r1=150):
    return (f'<circle class="ring" cx="{cx}" cy="{cy}" r="{r0}" opacity="0">'
            f'<animate attributeName="r" dur="{dur}" repeatCount="indefinite" values="{r0};{r0};{r1};{r1}" keyTimes="0;{t0};{t1};1"/>'
            f'<animate attributeName="opacity" dur="{dur}" repeatCount="indefinite" values="0;0;.8;0;0" keyTimes="0;{t0};{t0 + .005};{t1};1"/></circle>')

def appear(inner, t, dur, hide=.97):
    # Pop in at t (fade + slight scale), stay until hide.
    return (f'<g opacity="0">{inner}<animate attributeName="opacity" dur="{dur}" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;{t};{hide}"/></g>')

def rise(inner, t, dur, hide=.97):
    return (f'<g opacity="0">{inner}<animateTransform attributeName="transform" type="translate" dur="{dur}" repeatCount="indefinite" '
            f'calcMode="spline" keySplines="0 0 1 1;{EASE};0 0 1 1" values="0 -22;0 -22;0 0;0 0" keyTimes="0;{t};{round(t + .05, 3)};1"/>'
            f'<animate attributeName="opacity" dur="{dur}" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;{t};{hide}"/></g>')

def turtle_at(x, y, extra=""):
    return f'<g transform="translate({x} {y})"><g>{extra}{TURTLE}</g></g>'

def term_lines(x, y0, step, items, dur):
    """items: (kind, text, start[, end]) where kind is 'type' or 'show' or 'ok' or 'dim'."""
    outl = []
    for i, it in enumerate(items):
        kind, text, start = it[:3]
        end = it[3] if len(it) > 3 else None
        y = y0 + i * step if not isinstance(text, tuple) else text[1]
        if kind == "type":
            outl.append(typed(x, y, text, start, dur, end=end))
        else:
            cls = {"show": "code", "ok": "code ok", "dim": "code dim"}[kind]
            outl.append(shown(x, y, text, start, dur, end or 1, cls))
    return "".join(outl)

demo = {}

# ---------- ROS 1 vs ROS 2: architecture in motion ----------
d = "14s"
b = ['<line class="divider" x1="450" y1="8" x2="450" y2="300"/>',
     '<text class="s" x="220" y="16">ROS 1 · central master</text><text class="s" x="680" y="16">ROS 2 · peer-to-peer discovery</text>',
     wire("M95,235 L190,101"), wire("M345,235 L250,101"), wire("M170,263 L270,263"),
     node(140, 45, 160, 56, "roscore", "ROS master"),
     node(20, 235, 150, 56, "node", "/talker"), node(270, 235, 150, 56, "node", "/listener"),
     appear('<rect class="dim-over" x="138" y="43" width="164" height="60" rx="7"/><line class="xmark" x1="200" y1="58" x2="240" y2="88"/><line class="xmark" x1="240" y1="58" x2="200" y2="88"/>', .55, d),
     appear(wire("M300,140 L272,101") + node(270, 140, 150, 50, "node", "/listener2"), .68, d),
     packet("req", "M95,235 L190,101", .03, .1, d), flash(140, 45, 160, 56, .1, d),
     packet("req", "M345,235 L250,101", .11, .18, d), flash(140, 45, 160, 56, .18, d),
     packet("res", "M250,101 L345,235", .19, .26, d), flash(270, 235, 150, 56, .26, d),
     packet("fb", "M270,263 L170,263", .27, .32, d), flash(20, 235, 150, 56, .32, d)]
for t in (.34, .41, .48, .6, .67):
    b += [packet("req", "M170,263 L270,263", t, t + .05, d), flash(270, 235, 150, 56, t + .05, d)]
b += [packet("bad", "M300,140 L272,101", .72, .78, d), packet("bad", "M272,101 L300,140", .78, .84, d)]
b += [cap("1 · nodes register with the master", 0, .19, d, 220, 318), cap("2 · master says where the talker is", .19, .33, d, 220, 318),
      cap("3 · data flows directly (TCPROS)", .33, .55, d, 220, 318), cap("4 · master stops: old links survive", .55, .7, d, 220, 318),
      cap("5 · new nodes cannot find anyone", .7, 1, d, 220, 318)]
b += [wire("M630,263 L730,263"), node(480, 235, 150, 56, "node", "/talker"), node(730, 235, 150, 56, "node", "/listener"),
      appear(wire("M590,235 L660,170") + node(605, 120, 150, 50, "node", "/listener2"), .68, d),
      ring(555, 263, .02, .14, d), ring(805, 263, .05, .17, d), ring(555, 263, .1, .22, d), ring(680, 145, .68, .8, d)]
for t in (.22, .29, .36, .43, .5, .6):
    b += [packet("req", "M630,263 L730,263", t, t + .05, d), flash(730, 235, 150, 56, t + .05, d)]
for t in (.83, .91):
    b += [packet("req", "M630,263 L730,263", t, t + .05, d), packet("req", "M590,235 L660,170", t, t + .05, d), flash(605, 120, 150, 50, t + .05, d)]
b += [cap("1 · nodes announce themselves (DDS)", 0, .22, d, 680, 318), cap("2 · they connect directly, no broker", .22, .55, d, 680, 318),
      cap("3 · nothing central can fail", .55, .68, d, 680, 318), cap("4 · a new node is found at once", .68, 1, d, 680, 318)]
demo["arch"] = slide(OV, "ROS 1 vs ROS 2 architecture", "Centralized vs distributed", "ROS 1 vs ROS 2 architecture",
    svg(330, "Left, ROS 1: talker and listener register with the ROS master, which tells the listener where to connect; data then flows directly. When the master stops, a new node cannot connect. Right, ROS 2: nodes announce themselves with DDS discovery and connect directly; a new node joins and is found immediately.", "".join(b))
    + legend(("req", "registration / data"), ("res", "master reply"), ("fb", "connect"), ("bad", "failed lookup")),
    "Let the left side reach step 4 and ask: what happens to a robot in the field if roscore crashes? Existing ROS 1 connections survive, but nothing new can start. ROS 2 has no roscore command at all.")

d = "10s"
def stack(x0, rows, t0, step):
    o = []
    for i, row in enumerate(rows):
        y = 270 - i * 48
        w = 380 / len(row)
        inner = ""
        for j, (kind, name, cls) in enumerate(row):
            inner += node(x0 + j * w + (4 if j else 0), y, w - (4 if len(row) > 1 else 0), 40, kind, name, cls)
        o.append(rise(inner, round(t0 + i * step, 3), d))
    return "".join(o)
r1 = [[("os", "Ubuntu Linux", "block")], [("transport", "TCPROS / UDPROS", "block")], [("discovery", "ROS master · XML-RPC", "block")],
      [("client library", "roscpp", "block"), ("separate code", "rospy", "block")], [("you", "Your nodes", "block app")]]
r2 = [[("os", "Linux · Windows · macOS · RTOS", "block")], [("transport", "DDS / RTPS · or Zenoh", "block")], [("middleware API", "rmw", "block")],
      [("shared C core", "rcl", "block")], [("client library", "rclcpp", "block"), ("client library", "rclpy", "block"), ("microcontrollers", "rclc", "block")],
      [("you", "Your nodes", "block app")]]
b = ['<line class="divider" x1="450" y1="8" x2="450" y2="312"/>', '<text class="s" x="230" y="16">ROS 1</text><text class="s" x="670" y="16">ROS 2</text>',
     stack(40, r1, .03, .06), stack(480, r2, .36, .06),
     flash(480, 126, 380, 40, .74, d), flash(480, 174, 380, 40, .76, d), flash(40, 126, 186, 40, .74, d), flash(234, 126, 186, 40, .74, d),
     cap("each language re-implements it all", .74, 1, d, 230, 318), cap("one C core, swappable middleware", .74, 1, d, 670, 318)]
demo["stack"] = slide(OV, "ROS 1 vs ROS 2 software stack", "Layer by layer", "ROS 1 vs ROS 2 software stack",
    svg(330, "Two software stacks build up. ROS 1: Ubuntu, TCPROS, ROS master, separate roscpp and rospy, your nodes. ROS 2: Linux, Windows, macOS or RTOS, DDS or Zenoh, rmw, the shared rcl C core, rclcpp, rclpy and rclc, your nodes.", "".join(b)),
    "In ROS 1, roscpp and rospy were separate implementations, so features and bugs differed by language. In ROS 2, rcl is shared and rmw lets you swap the middleware without touching your code.")

# ---------- Turtlesim demo: topics ----------
d = "10s"
WX, WY, WS = 645, 45, 225
x0, y0 = wpt(WX, WY, WS, 5.544, 5.544)
r = round(2 * WS / WORLD, 1)
circle = f"M{x0},{y0} A{r},{r} 0 1 0 {x0},{round(y0 - 2 * r, 1)} A{r},{r} 0 1 0 {x0},{y0}"
cmd = "M440,85 L540,85 C595,85 600,120 645,120"; pose = "M645,235 C600,235 595,235 540,235 L440,235"
b = [term(20, 20, 420, 125, "terminal 1 · publish"),
     typed(34, 62, "$ ros2 topic pub --rate 1 /turtle1/cmd_vel \\", .01, d, .05),
     typed(34, 81, "    geometry_msgs/msg/Twist \\", .06, d, .03),
     typed(34, 100, f"    {Q}{{linear: {{x: 2.0}}, angular: {{z: 1.0}}}}{Q}", .09, d, .04),
     term(20, 175, 420, 135, "terminal 2 · echo"),
     typed(34, 217, "$ ros2 topic echo /turtle1/pose", .02, d, .04)]
poses = [(.07, .15, "x: 5.54  y: 5.54  theta: 0.00", "linear_velocity: 0.0"), (.15, .35, "x: 5.54  y: 5.54  theta: 0.00", "linear_velocity: 2.0"),
         (.35, .55, "x: 7.54  y: 7.54  theta: 1.57", "linear_velocity: 2.0"), (.55, .75, "x: 5.54  y: 9.54  theta: 3.14", "linear_velocity: 2.0"),
         (.75, .95, "x: 3.54  y: 7.54  theta: -1.57", "linear_velocity: 2.0"), (.95, 1, "x: 5.54  y: 5.54  theta: 0.00", "linear_velocity: 2.0")]
for s_, e_, l1, l2 in poses:
    b += [shown(34, 245, l1, s_, d, e_), shown(34, 266, l2, s_, d, e_, "code dim")]
b += [wire(cmd), wire(pose), node(465, 60, 150, 50, "topic", "/turtle1/cmd_vel", "pill topic"), node(465, 210, 150, 50, "topic", "/turtle1/pose", "pill topic"),
      win(WX, WY, WS), drive(circle, .15, .95, d)]
for k in range(9):
    t = round(.12 + k * .1, 3)
    b += [packet("req", cmd, t, t + .05, d), flash(WX, WY, WS, WS, t + .05, d, 2)]
for k in range(20):
    t = round(.15 + k * .04, 3)
    b.append(packet("fb", pose, t, t + .04, d))
demo["topic"] = slide("Day 1 · Topics", "Turtlesim demo: topics", "Turtlesim demo", "Topics: drive and listen",
    svg(320, "Terminal 1 publishes velocity commands on /turtle1/cmd_vel once per second and the turtle drives a circle; terminal 2 echoes /turtle1/pose and the position values change as it drives.", "".join(b))
    + legend(("req", "Twist on /turtle1/cmd_vel · 1 Hz"), ("fb", "Pose on /turtle1/pose · about 60 Hz")),
    "Run exactly this: ros2 run turtlesim turtlesim_node, then the two terminals. Linear 2.0 m/s with angular 1.0 rad/s gives a 2 m radius circle. Point out that the publisher and the echo never talk to each other; both just use topics. Docs: Tutorials › Beginner: CLI tools › Understanding topics.")

# ---------- Turtlesim demo: services ----------
d = "12s"
p0 = wpt(WX, WY, WS, 5.544, 5.544); p1 = wpt(WX, WY, WS, 8.0, 8.0); p2 = wpt(WX, WY, WS, 2.0, 2.0)
spawn = "M450,85 L540,85 C595,85 600,120 645,120"; spawn_r = "M645,120 C600,120 595,85 540,85 L450,85"
tele = "M450,185 L540,185 C595,185 600,200 645,200"; tele_r = "M645,200 C600,200 595,185 540,185 L450,185"
b = [term(20, 20, 430, 290, "terminal"),
     term_lines(34, 62, 19, [("type", "$ ros2 service call /spawn turtlesim/srv/Spawn \\", .01),
                             ("type", f"  {Q}{{x: 2.0, y: 2.0, theta: 0.0, name: 'turtle2'}}{Q}", .04)], d),
     shown(34, 110, "response:", .28, d), shown(34, 129, "turtlesim.srv.Spawn_Response(name='turtle2')", .28, d, 1, "code ok"),
     term_lines(34, 160, 19, [("type", "$ ros2 service call /turtle1/teleport_absolute \\", .46),
                              ("type", "  turtlesim/srv/TeleportAbsolute \\", .5),
                              ("type", f"  {Q}{{x: 8.0, y: 8.0, theta: 1.57}}{Q}", .53)], d),
     shown(34, 230, "response:", .78, d), shown(34, 249, "turtlesim.srv.TeleportAbsolute_Response()", .78, d, 1, "code ok"),
     wire(spawn), wire(tele),
     node(470, 60, 140, 50, "service", "/spawn", "pill"), node(470, 160, 140, 50, "/turtle1/", "teleport_absolute", "pill"),
     win(WX, WY, WS),
     f'<line class="pen" x1="{p0[0]}" y1="{p0[1]}" x2="{p1[0]}" y2="{p1[1]}" opacity="0">{vis(.66, 1, d)}</line>',
     f'<g transform="translate({p0[0]} {p0[1]})"><animateTransform attributeName="transform" type="translate" dur="{d}" repeatCount="indefinite" calcMode="discrete" values="{p0[0]} {p0[1]};{p1[0]} {p1[1]}" keyTimes="0;.66"/>'
     f'<g><animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" calcMode="discrete" values="0;-90" keyTimes="0;.66"/>{TURTLE}</g></g>',
     appear(f'<g transform="translate({p2[0]} {p2[1]})"><g><animateTransform attributeName="transform" type="scale" dur="{d}" repeatCount="indefinite" values=".2;.2;1.3;1;1" keyTimes="0;.2;.23;.26;1"/>{TURTLE}</g></g>'
            f'<text class="k" x="{p2[0]}" y="{p2[1] + 22}">turtle2</text>', .2, d),
     packet("req", spawn, .07, .17, d), flash(WX, WY, WS, WS, .17, d, 2), packet("res", spawn_r, .2, .28, d),
     packet("req", tele, .56, .66, d), flash(WX, WY, WS, WS, .66, d, 2), packet("res", tele_r, .7, .78, d)]
demo["service"] = slide("Day 1 · Services and actions", "Turtlesim demo: services", "Turtlesim demo", "Services: ask once, get one answer",
    svg(320, "A service call to /spawn creates turtle2 at x 2, y 2 and returns its name; a second call to /turtle1/teleport_absolute moves turtle1 to x 8, y 8 facing up, drawing a line, and returns an empty response.", "".join(b))
    + legend(("req", "request"), ("res", "response")),
    "Each call blocks the terminal until the single response arrives. The pen draws the teleport because turtle1's pen is down; ask how participants would turn it off (hint: the /turtle1/set_pen service). Docs: Tutorials › Beginner: CLI tools › Understanding services.")

# ---------- Turtlesim demo: actions ----------
d = "12s"
c0 = wpt(WX, WY, WS, 5.544, 5.544)
lanes = {"goal": 67, "fb": 157, "res": 247}
b = [term(20, 20, 430, 290, "terminal"),
     term_lines(34, 62, 19, [("type", "$ ros2 action send_goal --feedback \\", .01), ("type", "  /turtle1/rotate_absolute \\", .04),
                             ("type", "  turtlesim/action/RotateAbsolute \\", .06), ("type", f"  {Q}{{theta: 1.57}}{Q}", .08)], d),
     shown(34, 145, "Goal accepted with ID: 8b1f…", .27, d, 1, "code ok"),
     # The CLI prints each feedback as "Feedback:" then an indented field; show the latest value.
     shown(34, 169, "Feedback:", .36, d), shown(34, 188, "    remaining: 1.18", .36, d, .5),
     shown(34, 188, "    remaining: 0.69", .5, d, .64), shown(34, 188, "    remaining: 0.21", .64, d),
     shown(34, 236, "Goal finished with status: SUCCEEDED", .82, d, 1, "code ok")]
b += [wire(f"M450,{y} L{WX},{y}") for y in lanes.values()]
b += [node(470, 45, 140, 44, "action", "goal", "pill"), node(470, 135, 140, 44, "action", "feedback", "pill topic"), node(470, 225, 140, 44, "action", "result", "pill"),
      win(WX, WY, WS),
      f'<line class="goal-line" x1="{c0[0]}" y1="{c0[1]}" x2="{c0[0]}" y2="{c0[1] - 55}" opacity="0">{vis(.2, 1, d)}</line>',
      f'<g transform="translate({c0[0]} {c0[1]})"><g><animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;{EASE};0 0 1 1" values="0;0;-90;-90" keyTimes="0;.28;.76;1"/>{TURTLE}</g></g>',
      packet("req", f"M450,67 L{WX},67", .12, .2, d), flash(WX, WY, WS, WS, .2, d, 2),
      packet("res", f"M{WX},67 L450,67", .2, .27, d), packet("req", f"M450,247 L{WX},247", .28, .34, d)]
for t in (.36, .5, .64):
    b.append(packet("fb", f"M{WX},157 L450,157", t - .05, t, d))
b.append(packet("res", f"M{WX},247 L450,247", .76, .82, d))
demo["action"] = slide("Day 1 · Services and actions", "Turtlesim demo: actions", "Turtlesim demo", "Actions: a goal with progress",
    svg(320, "An action goal asks /turtle1/rotate_absolute to turn the turtle to 1.57 radians. The goal is accepted, the turtle turns slowly while feedback reports the remaining angle, and the result reports success.", "".join(b))
    + legend(("req", "goal / result request"), ("res", "accepted / result"), ("fb", "feedback")),
    "Turtlesim rotates at a fixed speed, so the feedback counts down. Press Ctrl+C during a second goal to show cancellation; the turtle stops where it is. Docs: Tutorials › Beginner: CLI tools › Understanding actions.")

# ---------- Turtlesim demo: parameters ----------
d = "12s"
bg = '<animate attributeName="fill" dur="12s" repeatCount="indefinite" values="#4556ff;#4556ff;#c856ff;#c856ff;#4556ff;#4556ff" keyTimes="0;.38;.42;.71;.75;1"/>'
c0 = wpt(WX, WY, WS, 5.544, 5.544)
pr = "M450,158 L645,158"; pr_r = "M645,158 L450,158"
b = [term(20, 20, 430, 290, "terminal"),
     typed(34, 62, "$ ros2 param get /turtlesim background_r", .01, d), shown(34, 81, "Integer value is: 69", .2, d, 1, "code ok"),
     typed(34, 112, "$ ros2 param set /turtlesim background_r 200", .25, d), shown(34, 131, "Set parameter successful", .45, d, 1, "code ok"),
     typed(34, 162, "$ ros2 param set /turtlesim background_r 69", .58, d), shown(34, 181, "Set parameter successful", .78, d, 1, "code ok"),
     wire(pr), node(470, 130, 150, 56, "parameters", "/turtlesim", "pill"),
     win(WX, WY, WS, bg_anim=bg), turtle_at(*c0),
     f'<text class="code hot" x="{WX}" y="292">background_r: 69<animate attributeName="opacity" dur="{d}" repeatCount="indefinite" calcMode="discrete" values="1;0;1" keyTimes="0;.38;.71"/></text>',
     f'<text class="code hot" x="{WX}" y="292" opacity="0">background_r: 200<animate attributeName="opacity" dur="{d}" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;.38;.71"/></text>',
     packet("req", pr, .06, .13, d), flash(WX, WY, WS, WS, .13, d, 2), packet("res", pr_r, .13, .2, d),
     packet("req", pr, .31, .38, d), flash(WX, WY, WS, WS, .38, d, 2), packet("res", pr_r, .38, .45, d),
     packet("req", pr, .64, .71, d), flash(WX, WY, WS, WS, .71, d, 2), packet("res", pr_r, .71, .78, d)]
demo["params"] = slide("Day 1 · Runtime orchestration", "Turtlesim demo: parameters", "Turtlesim demo", "Parameters: change behavior live",
    svg(305, "ros2 param get reads background_r as 69; ros2 param set changes it to 200 and the turtlesim window turns pink; setting it back to 69 turns it blue again.", "".join(b))
    + legend(("req", "get / set request"), ("res", "response"))
    + '      <p class="callout">Every node gets parameter services automatically: <code>/turtlesim/get_parameters</code>, <code>/turtlesim/set_parameters</code>, and more.</p>\n',
    "Run ros2 service list while turtlesim runs to show the parameter services. A node can reject a value in its parameter callback, and the CLI then prints the reason. Docs: Tutorials › Beginner: CLI tools › Understanding parameters.")

# ---------- Turtlesim demo: launch (mimic) ----------
d = "12s"
A, B, S2 = (545, 45), (725, 45), 165
def wcircle(wx, wy, s):
    cx, cy = wpt(wx, wy, s, 5.544, 5.544); rr = round(1.111 * s / WORLD, 1)
    arc = f"A{rr},{rr} 0 1 1 {cx},{round(cy + 2 * rr, 1)} A{rr},{rr} 0 1 1 {cx},{cy}"
    return f"M{cx},{cy} {arc} {arc}", (cx, cy)
c1, s1 = wcircle(*A, S2); c2, s2 = wcircle(*B, S2)
pub = "M320,215 C340,215 345,120 360,70"; pose = "M425,70 L425,135"; cmd = "M425,185 L425,250"
b = [term(20, 15, 300, 110, "terminal 1"),
     typed(34, 57, "$ ros2 launch turtlesim \\", .01, d), typed(34, 76, "  turtlesim_mimic_launch.py", .04, d),
     term(20, 180, 300, 145, "terminal 2"),
     term_lines(34, 222, 19, [("type", "$ ros2 topic pub -r 1 \\", .34), ("type", "  /turtlesim1/turtle1/cmd_vel \\", .36),
                              ("type", "  geometry_msgs/msg/Twist \\", .38), ("type", f"  {Q}{{linear: {{x: 2.0}},", .4), ("type", f"   angular: {{z: -1.8}}}}{Q}", .42)], d),
     wire(pub), wire(pose), wire(cmd), wire(f"M505,45 L{A[0]},60"), wire(f"M505,275 C650,275 790,260 {B[0] + S2 / 2},{B[1] + S2}"),
     '<text class="k left" x="435" y="103">pose</text><text class="k left" x="435" y="218">cmd_vel</text>']
for (y, name, t) in ((20, "/turtlesim1/sim", .08), (135, "/mimic", .14), (250, "/turtlesim2/sim", .2)):
    b.append(rise(node(345, y, 160, 50, "node", name), t, d))
for (wx, wy), path, start, title in ((A, c1, .48, "turtlesim1"), (B, c2, .5, "turtlesim2")):
    b.append(rise(win(wx, wy, S2, title) + drive(path, start, .96, d), .1 if title.endswith("1") else .22, d))
for k in range(6):
    t = round(.46 + k * .08, 3)
    b += [packet("req", pub, t, t + .04, d), flash(345, 20, 160, 50, t + .04, d)]
for k in range(9):
    t = round(.5 + k * .05, 3)
    b += [packet("fb", pose, t, t + .025, d), packet("req", cmd, t + .025, t + .05, d)]
demo["launch"] = slide("Day 1 · Runtime orchestration", "Turtlesim demo: launch", "Turtlesim demo", "Launch: one command, a whole system",
    svg(335, "ros2 launch starts two turtlesim nodes in namespaces turtlesim1 and turtlesim2 plus a mimic node. Publishing velocity to turtlesim1 makes turtle 1 drive a circle; mimic copies its pose into commands for turtlesim2, so turtle 2 drives the same circle.", "".join(b))
    + legend(("req", "cmd_vel"), ("fb", "pose")),
    "This is the official 'Creating a launch file' tutorial. One launch file starts three nodes, namespaces keep the turtles apart, and remappings wire mimic between them without code changes. Docs: Tutorials › Intermediate › Launch › Creating a launch file.")

# ---------- Turtlesim demo: ros2 bag ----------
d = "14s"
BX, BY, BS = 600, 40, 270
sx, sy = wpt(BX, BY, BS, 5.544, 5.544)
route = f"M{sx},{sy} c60,0 85,-70 50,-105 c-35,-35 -120,-25 -130,35 c-10,50 35,75 75,60"
into = f"M{BX},150 L520,150"; outof = f"M520,175 L{BX},175"
b = [term(20, 20, 345, 290, "terminal"),
     typed(34, 62, "$ ros2 bag record -o drive \\", .01, d), typed(34, 81, "  /turtle1/cmd_vel /turtle1/pose", .03, d),
     shown(34, 105, "# drive with teleop_turtle_key …", .06, d, 1, "code dim"),
     shown(34, 129, "^C  # stop recording", .46, d, 1, "code dim"),
     typed(34, 160, "$ ros2 bag play drive", .52, d), shown(34, 184, "# same commands, same timing", .55, d, 1, "code dim"),
     wire(into), wire(outof),
     '<rect class="bag" x="400" y="90" width="120" height="140"/><ellipse class="bag" cx="460" cy="230" rx="60" ry="14"/><ellipse class="bag" cx="460" cy="90" rx="60" ry="14"/>',
     '<text class="s" x="460" y="150">drive/</text><text class="k" x="460" y="172">MCAP bag</text>',
     win(BX, BY, BS),
     f'<g>{drive(route, .08, .44, d)}{vis(0, .47, d)}</g>',
     f'<g opacity="0">{drive(route, .55, .92, d, "pen play")}{vis(.5, 1, d)}</g>',
     cap("recording a teleop drive", 0, .47, d, 735, 324), cap("replaying it from the bag", .5, 1, d, 735, 324)]
for k in range(11):
    t = round(.09 + k * .032, 3)
    b.append(packet("req" if k % 2 else "fb", into, t, t + .03, d))
for k in range(12):
    t = round(.55 + k * .032, 3)
    b += [packet("req", outof, t, t + .03, d)]
b.append(flash(400, 90, 120, 140, .44, d, 2))
demo["bag"] = slide("Day 1 · Runtime orchestration", "Turtlesim demo: ros2 bag", "Turtlesim demo", "ros2 bag: record once, replay anytime",
    svg(335, "While the turtle is driven with teleop, ros2 bag record stores cmd_vel and pose messages in a bag. After stopping, ros2 bag play sends the recorded commands back and the turtle repeats the same path.", "".join(b))
    + legend(("req", "cmd_vel"), ("fb", "pose")),
    "This follows the 'Recording and playing back data' tutorial. Clear the window or restart turtlesim before playing so participants can see the turtle redraw the same path. Docs: Tutorials › Beginner: CLI tools › Recording and playing back data.")

# ---------- Improved pub/sub, service, action diagrams (svg + legend only) ----------
d = "4.5s"
up = "M200,130 L540,130 C620,130 620,65 700,65"; down = "M200,130 L540,130 C620,130 620,195 700,195"
b = [wire("M200,130 L360,130"), wire("M540,130 C620,130 620,65 700,65"), wire("M540,130 C620,130 620,195 700,195"),
     node(20, 95, 180, 70, "publisher", "/lidar"), node(360, 100, 180, 60, "topic", "/scan", "pill topic"),
     node(700, 30, 180, 70, "subscriber", "/mapper"), node(700, 160, 180, 70, "subscriber", "/obstacle_monitor")]
for st in (.01, .34, .67):
    b += [flash(20, 95, 180, 70, st, d), packet("req", up, st, st + .3, d), packet("req", down, st, st + .3, d),
          flash(700, 30, 180, 70, st + .3, d), flash(700, 160, 180, 70, st + .3, d)]
svgs = {}
svgs["Publish and subscribe"] = svg(260, "The /lidar publisher sends LaserScan messages on the /scan topic and every message reaches both subscribers, /mapper and /obstacle_monitor", "".join(b)) + legend(("req", "sensor_msgs/msg/LaserScan message · 10 Hz"))

d = "6s"
A_ = "M200,65 C280,65 280,130 360,130 L700,130"; Ar = "M700,130 L360,130 C280,130 280,65 200,65"
B_ = "M200,195 C280,195 280,130 360,130 L700,130"; Br = "M700,130 L360,130 C280,130 280,195 200,195"
b = [wire("M200,65 C280,65 280,130 360,130"), wire("M200,195 C280,195 280,130 360,130"), wire("M540,130 L700,130"),
     node(20, 30, 180, 70, "client node", "/client_a"), node(20, 160, 180, 70, "client node", "/client_b"),
     node(360, 100, 180, 60, "service", "/spawn", "pill"), node(700, 95, 180, 70, "server node", "/turtlesim"),
     packet("req", A_, .01, .22, d), flash(700, 95, 180, 70, .22, d), packet("res", Ar, .26, .48, d), flash(20, 30, 180, 70, .48, d),
     packet("req", B_, .52, .74, d), flash(700, 95, 180, 70, .74, d), packet("res", Br, .78, .98, d), flash(20, 160, 180, 70, .975, d),
     cap("/client_a sends a request", 0, .24, d, 450, 275), cap("the server replies to /client_a only", .24, .5, d, 450, 275),
     cap("/client_b sends a request", .5, .76, d, 450, 275), cap("the server replies to /client_b only", .76, 1, d, 450, 275)]
svgs["Service request and response"] = svg(290, "Two client nodes send requests through the /spawn service to one server node, and each request returns one response", "".join(b)) + legend(("req", "request"), ("res", "response"))

d = "9s"
subs_c = "".join(f'<rect class="sub" x="35" y="{y - 25}" width="190" height="50" rx="4"/><text class="s" x="130" y="{y}">{t}</text>' for t, y in [("Goal client", 85), ("Feedback subscriber", 175), ("Result client", 265)])
subs_s = "".join(f'<rect class="sub" x="675" y="{y - 25}" width="190" height="50" rx="4"/><text class="s" x="770" y="{y}">{t}</text>' for t, y in [("Goal server", 85), ("Feedback publisher", 175), ("Result server", 265)])
pills = "".join(f'<rect class="pill{" topic" if k == "fb" else ""}" x="370" y="{y - 20}" width="160" height="40" rx="20"/><text class="s" x="450" y="{y}">{t}</text>' for k, t, y in [("goal", "goal service", 85), ("fb", "feedback topic", 175), ("res", "result service", 265)])
fwd = lambda y: f"M225,{y} L675,{y}"; back = lambda y: f"M675,{y} L225,{y}"
b = ["".join(wire(fwd(y)) for y in (85, 175, 265)),
     '<rect class="node" x="20" y="20" width="220" height="290" rx="6"/><text class="k" x="130" y="40">action client node</text>', subs_c,
     '<rect class="node" x="660" y="20" width="220" height="290" rx="6"/><text class="k" x="770" y="40">action server node</text>', subs_s, pills,
     '<rect class="track" x="685" y="192" width="170" height="5" rx="2"/>',
     f'<rect class="progress" x="685" y="192" height="5" rx="2" width="0"><animate attributeName="width" dur="{d}" repeatCount="indefinite" values="0;0;170;170;0" keyTimes="0;.41;.84;.97;1"/></rect>',
     packet("req", fwd(85), 0, .12, d), flash(675, 60, 190, 50, .12, d, 4), packet("res", back(85), .14, .26, d), flash(35, 60, 190, 50, .26, d, 4),
     packet("req", fwd(265), .28, .4, d), flash(675, 240, 190, 50, .4, d, 4)]
for st in (.42, .56, .7):
    b += [packet("fb", back(175), st, st + .12, d), flash(35, 150, 190, 50, st + .12, d, 4)]
b += [packet("res", back(265), .85, .97, d), flash(35, 240, 190, 50, .97, d, 4),
      cap("1 · send goal", 0, .13, d, 450, 336), cap("2 · goal accepted", .13, .27, d, 450, 336), cap("3 · ask for the result", .27, .41, d, 450, 336),
      cap("4 · feedback while the goal runs", .41, .84, d, 450, 336), cap("5 · result arrives", .84, 1, d, 450, 336)]
svgs["Action lifecycle"] = svg(350, "An action client sends a goal through the goal service, requests the result, receives feedback on a topic while a progress bar fills, and finally receives the result", "".join(b)) + legend(("req", "request"), ("res", "response"), ("fb", "feedback message"))


# ---------- ROS 2 distributions over time ----------
# Dates from docs.ros.org/en/jazzy/Releases.html (decimal years). TODAY is the workshop date.
TODAY, Y0, Y1 = 2026.83, 2015.5, 2031.5
X0, X1 = 170, 885
yx = lambda y: round(X0 + (y - Y0) / (Y1 - Y0) * (X1 - X0), 1)
SWEEP = .72   # fraction of the cycle spent sweeping from Y0 to TODAY
tf_ = lambda y: round(min(max((y - Y0) / (TODAY - Y0), 0), 1) * SWEEP, 4)
DISTROS = [  # name, release, eol, kind
    ("alpha · beta", 2015.67, 2017.95, "pre"), ("Ardent Apalone", 2017.94, 2018.95, "std"), ("Bouncy Bolson", 2018.50, 2019.50, "std"),
    ("Crystal Clemmys", 2018.95, 2019.95, "std"), ("Dashing Diademata", 2019.41, 2021.41, "lts"), ("Eloquent Elusor", 2019.89, 2020.88, "std"),
    ("Foxy Fitzroy", 2020.43, 2023.47, "lts"), ("Galactic Geochelone", 2021.39, 2022.94, "std"), ("Humble Hawksbill", 2022.39, 2027.38, "lts"),
    ("Iron Irwini", 2023.39, 2024.93, "std"), ("Jazzy Jalisco", 2024.39, 2029.38, "lts"), ("Kilted Kaiju", 2025.39, 2026.95, "std"),
    ("Lyrical Luth", 2026.39, 2031.38, "lts"), ("Rolling Ridley", 2020.43, Y1, "rolling"), ("Makoa Mata-mata", 2027.39, 2028.95, "future")]
FILL = {"pre": "#5b6478", "std": "#6aa8ff", "lts": "#58e0d2", "rolling": "#ffb15a", "eol": "#3a4560"}
d = "18s"
b = []
for y in range(2016, 2032):
    x = yx(y)
    b.append(f'<line class="tick" x1="{x}" y1="24" x2="{x}" y2="330"/><text class="k" x="{x}" y="14">{y}</text>')
for i, (name, rel, eol, kind) in enumerate(DISTROS):
    y = 34 + i * 19.5
    x0, x1 = yx(rel), yx(eol)
    if kind == "future":
        b.append(f'<g opacity="0"><rect class="bar future" x="{x0}" y="{y}" width="{x1 - x0}" height="13" rx="3"/><text class="dname dim" x="{X0 - 8}" y="{y + 7}">{name}</text>{vis(SWEEP + .02, 1, d)}</g>')
        continue
    ts, te = tf_(rel), tf_(min(eol, TODAY))
    w_now = max(yx(min(eol, TODAY)) - x0, 0)
    grow = (f'<rect class="bar" fill="{FILL[kind]}" x="{x0}" y="{y}" height="13" rx="3" width="0">'
            f'<animate attributeName="width" dur="{d}" repeatCount="indefinite" values="0;0;{w_now};{w_now}" keyTimes="0;{ts};{max(te, ts + .001)};1"/>')
    if eol < TODAY:   # turns grey once the sweep passes its end of life
        grow += f'<animate attributeName="fill" dur="{d}" repeatCount="indefinite" calcMode="discrete" values="{FILL[kind]};{FILL["eol"]}" keyTimes="0;{te}"/>'
    b.append(grow + '</rect>')
    if eol > TODAY and kind != "rolling":   # remaining support shown as an outline after the sweep reaches today
        b.append(f'<rect class="bar ahead" x="{yx(TODAY)}" y="{y}" width="{x1 - yx(TODAY)}" height="13" rx="3" opacity="0">{vis(SWEEP, 1, d)}</rect>')
    b.append(f'<text class="dname" x="{X0 - 8}" y="{y + 7}" opacity="0">{name}{vis(ts, 1, d)}</text>')
b.append(f'<line class="today" x1="{yx(Y0)}" y1="22" x2="{yx(Y0)}" y2="330"><animate attributeName="x1" dur="{d}" repeatCount="indefinite" values="{yx(Y0)};{yx(TODAY)};{yx(TODAY)}" keyTimes="0;{SWEEP};1"/>'
         f'<animate attributeName="x2" dur="{d}" repeatCount="indefinite" values="{yx(Y0)};{yx(TODAY)};{yx(TODAY)}" keyTimes="0;{SWEEP};1"/></line>')
b.append(f'<text class="cap" x="{yx(TODAY) + 6}" y="342" opacity="0">today · supported: Humble, Jazzy, Kilted, Lyrical{vis(SWEEP, 1, d)}</text>')
demo["distros"] = slide(OV, "ROS 2 distributions over time", "docs.ros.org › Distributions", "ROS 2 distributions over time",
    svg(350, "Animated timeline of ROS 2 distributions from the 2015 alphas to today: Ardent 2017 through Lyrical 2026, with LTS releases lasting five years, Rolling since 2020, and Makoa planned for May 2027.", "".join(b))
    + legend(("lts", "LTS · 5 years"), ("std", "non-LTS · about 1.5 years"), ("eol", "end of life"), ("rolling", "Rolling"), ("future", "planned")),
    "Releases are named alphabetically after turtles and arrive every May 23, World Turtle Day. Even years are LTS with five years of support; odd years get about 18 months. On the workshop date Humble, Jazzy, Kilted, and Lyrical are supported. Source: docs.ros.org Releases page.")

# ---------- History of ROS and ROS 2, animated ----------
H0, H1, HT = 2006.6, 2027.2, 2026.83
hx = lambda y: round(40 + (y - H0) / (H1 - H0) * 820, 1)
ht = lambda y: round(min(max((y - H0) / (HT - H0), 0), 1) * .78, 4)
d = "20s"
ROS1 = [("B", 2010.17), ("C", 2010.59), ("D", 2011.17), ("E", 2011.66), ("F", 2012.31), ("G", 2012.99), ("H", 2013.68), ("I", 2014.56), ("J", 2015.39), ("K", 2016.39), ("L", 2017.39), ("M", 2018.39), ("N", 2020.39)]
ROS2 = [("A", 2017.94), ("B", 2018.50), ("C", 2018.95), ("D", 2019.41), ("E", 2019.89), ("F", 2020.43), ("G", 2021.39), ("H", 2022.39), ("I", 2023.39), ("J", 2024.39), ("K", 2025.39), ("L", 2026.39)]
EVENTS = [  # year, lane (1 above / 2 below), title, detail
    (2007.3, 1, "2007 · Stanford STAIR", "Willow Garage starts ROS"), (2010.17, 1, "2010 · Box Turtle", "ROS 1.0, built for the PR2"),
    (2012.3, 1, "2012 · OSRF founded", "first ROSCon"), (2014.8, 1, "2014 · Indigo LTS", "ROS 2 design begins"),
    (2015.67, 2, "2015 · ROS 2 alpha", "rebuilt on DDS"), (2017.94, 2, "2017 · Ardent", "first ROS 2 release"),
    (2020.39, 1, "2020 · Noetic", "last ROS 1 release"), (2020.43, 2, "2020 · Foxy LTS", "Rolling starts"),
    (2022.9, 2, "2022 · Humble LTS", "Open Robotics joins Intrinsic"), (2025.41, 1, "May 2025", "ROS 1 end of life"),
    (2024.39, 2, "2024 · Jazzy LTS", "this workshop"), (2026.39, 2, "2026 · Lyrical LTS", "newest release")]
L1, L2 = 140, 230
b = [f'<text class="lane1" x="4" y="{L1 + 1}">ROS 1</text><text class="lane2" x="4" y="{L2 + 1}">ROS 2</text>']
for y in range(2008, 2027, 2):
    b.append(f'<text class="k" x="{hx(y)}" y="{(L1 + L2) / 2 + 1}">{y}</text>')
def lane_bar(y, c, x0, x1, t0, t1):
    w = x1 - x0
    return (f'<rect class="{c}" x="{x0}" y="{y - 3}" height="6" rx="3" width="0"><animate attributeName="width" dur="{d}" repeatCount="indefinite" '
            f'values="0;0;{w};{w}" keyTimes="0;{t0};{max(t1, t0 + .001)};1"/></rect>')
b.append(lane_bar(L1, "lane-ros1", hx(2007.3), hx(2025.41), ht(2007.3), ht(2025.41)))
b.append(lane_bar(L2, "lane-ros2", hx(2015.67), hx(HT), ht(2015.67), ht(HT)))
b.append(f'<text class="eol" x="{hx(2025.41) + 6}" y="{L1 + 4}" opacity="0">EOL{vis(ht(2025.41), 1, d)}</text>')
for letters, y, cls, up in ((ROS1, L1, "lane1", 1), (ROS2, L2, "lane2", -1)):   # letters sit between the lanes
    for ch, yr in letters:
        x = hx(yr)
        b.append(f'<g opacity="0"><circle class="{cls}-dot" cx="{x}" cy="{y}" r="5"/><text class="letter {cls}" x="{x}" y="{y + 15 * up}">{ch}</text>{vis(ht(yr), 1, d)}</g>')
rows = {1: [[], [], []], 2: [[], [], []]}
for i, (yr, lane, title, detail) in enumerate(EVENTS):
    x = hx(yr)
    row = next(k for k, used in enumerate(rows[lane]) if all(abs(u_ - x) >= 135 for u_ in used))   # first row with room
    rows[lane][row].append(x)
    y = (L1 - 46 - row * 40) if lane == 1 else (L2 + 30 + row * 40)
    cls = "card1" if lane == 1 else "card2"
    b.append(f'<g opacity="0"><line class="stem" x1="{x}" y1="{L1 if lane == 1 else L2}" x2="{x}" y2="{y + (30 if lane == 1 else 0)}"/>'
             f'<rect class="{cls}" x="{x - 64}" y="{y}" width="128" height="30" rx="4"/><text class="ct" x="{x}" y="{y + 10}">{title}</text>'
             f'<text class="cd" x="{x}" y="{y + 22}">{detail}</text>{vis(ht(yr), 1, d)}</g>')
b.append(f'<line class="today" x1="{hx(H0)}" y1="40" x2="{hx(H0)}" y2="342"><animate attributeName="x1" dur="{d}" repeatCount="indefinite" values="{hx(H0)};{hx(HT)};{hx(HT)}" keyTimes="0;.78;1"/>'
         f'<animate attributeName="x2" dur="{d}" repeatCount="indefinite" values="{hx(H0)};{hx(HT)};{hx(HT)}" keyTimes="0;.78;1"/></line>')
demo["history"] = slide(OV, "History of ROS and ROS 2", "From a lab project to an industry standard", "History of ROS and ROS 2",
    svg(345, "Animated history: ROS 1 from Stanford and Willow Garage in 2007 through Box Turtle, OSRF, and Noetic to its end of life in May 2025; ROS 2 from the 2015 alphas through Ardent, Foxy, Humble, Jazzy, and Lyrical. Letters mark each distribution.", "".join(b))
    + legend(("lane-ros1", "ROS 1 · 13 distributions"), ("lane-ros2", "ROS 2 · 12 distributions so far")),
    "Each letter is a distribution, named alphabetically. ROS 1 ran from Box Turtle to Noetic; ROS 2 restarted at A with Ardent. ROS 1 reached end of life on May 31, 2025. Pause with K to talk about any milestone.")

# ---------- One robot, many programs: ad-hoc links vs one ROS 2 graph ----------
d = "18s"
def card(x, y, title, sub, t, cls="node"):
    return (f'<g opacity="0"><rect class="{cls}" x="{x}" y="{y}" width="190" height="54" rx="6"/>'
            f'<text class="s" x="{x + 95}" y="{y + 20}">{title}</text><text class="k" x="{x + 95}" y="{y + 38}">{sub}</text>{vis(t, 1, d)}</g>')
CAM, DET, PLN, CTL = (40, 30), (670, 30), (670, 256), (40, 256)
b = [card(*CAM, "Camera driver", "produces images", .01), card(*DET, "Object detector", "finds objects", .03),
     card(*PLN, "Motion planner", "chooses a path", .05), card(*CTL, "Motor controller", "drives the joints", .07)]
# the robot in the middle: base, wheels, mast camera, and a two-link arm that moves when commanded
arm = (f'<g><animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" calcMode="spline" '
       f'keySplines="0 0 1 1;{EASE};{EASE};0 0 1 1;{EASE};{EASE};0 0 1 1" values="0 432 196;0 432 196;-35 432 196;0 432 196;0 432 196;-35 432 196;0 432 196;0 432 196" keyTimes="0;.62;.66;.70;.91;.95;.99;1"/>'
       '<rect class="robot-part" x="426" y="146" width="12" height="50" rx="6"/><circle class="joint" cx="432" cy="196" r="6"/>'
       '<g><rect class="robot-part" x="428" y="118" width="40" height="10" rx="5"/><circle class="joint" cx="432" cy="146" r="5"/><rect class="robot-part" x="464" y="112" width="6" height="22" rx="2"/></g></g>')
b.append('<g class="robot"><rect class="robot-body" x="395" y="196" width="110" height="34" rx="9"/><circle class="wheel" cx="415" cy="232" r="9"/><circle class="wheel" cx="485" cy="232" r="9"/>'
         '<rect class="robot-part" x="476" y="150" width="6" height="46"/><rect class="robot-body" x="466" y="138" width="28" height="16" rx="3"/><circle class="lens" cx="494" cy="146" r="4"/>' + arm + '</g>')
# phase 1: every pair invents its own link
TANGLE = [("M230,57 C420,0 480,0 670,57", "TCP socket", 450, 22), ("M670,57 C760,140 760,180 765,256", "shared memory", 790, 160),
          ("M670,283 C480,330 400,330 230,283", "CSV file", 450, 322), ("M135,256 C100,180 100,140 135,84", "custom UDP", 92, 172),
          ("M230,70 C420,130 520,210 670,270", "serial bytes", 560, 196), ("M230,270 C380,210 520,120 670,70", "REST call", 330, 130)]
for i, (p, lbl, lx, ly) in enumerate(TANGLE):
    t0 = round(.09 + i * .025, 3)
    b.append(f'<g><path class="tangle" d="{p}" pathLength="1" stroke-dasharray="1 1"><animate attributeName="stroke-dashoffset" dur="{d}" repeatCount="indefinite" values="1;1;0;0" keyTimes="0;{t0};{t0 + .04};1"/></path>'
             f'<text class="tangle-label" x="{lx}" y="{ly}" opacity="0">{lbl}{vis(t0 + .03, .34, d)}</text>'
             f'<animate attributeName="opacity" dur="{d}" repeatCount="indefinite" values="1;1;0;0" keyTimes="0;.32;.36;1"/></g>')
# phase 2: one shared graph
RING = "M260,110 L640,110 L640,248 L260,248 Z"
b.append(f'<g opacity="0"><path class="graph-ring" d="{RING}"/>'
         '<line class="stem" x1="230" y1="84" x2="260" y2="110"/><line class="stem" x1="670" y1="84" x2="640" y2="110"/>'
         '<line class="stem" x1="670" y1="256" x2="640" y2="248"/><line class="stem" x1="230" y1="256" x2="260" y2="248"/>'
         f'<text class="ring-label" x="450" y="99">ROS 2 graph · discovery · typed messages · QoS</text>{vis(.37, 1, d)}</g>')
b.append(f'<circle class="ring" cx="450" cy="170" r="40" opacity="0"><animate attributeName="r" dur="{d}" repeatCount="indefinite" values="40;40;230;230" keyTimes="0;.37;.43;1"/>'
         f'<animate attributeName="opacity" dur="{d}" repeatCount="indefinite" values="0;0;.8;0;0" keyTimes="0;.37;.371;.43;1"/></circle>')
# phase 3: data around the loop, twice
HOPS = [("M494,146 L640,110 L250,110 L230,84", "req", "raw pixels from the camera", CAM),
        ("M230,84 L260,110 L640,110 L670,84", "req", "/image · sensor_msgs/msg/Image", DET),
        ("M670,84 L640,110 L640,248 L670,256", "req", "/objects · object positions", PLN),
        ("M670,256 L640,248 L260,248 L230,256", "fb", "goal: follow this path (action)", CTL),
        ("M230,256 L260,248 L432,196", "res", "joint commands to the motors", None)]
for loop, start in enumerate((.44, .73)):
    for k, (p, cls, text, target) in enumerate(HOPS):
        s0 = round(start + k * .045, 3); e0 = round(s0 + .04, 3)
        b.append(packet(cls, p, s0, e0, d))
        if target: b.append(flash(target[0], target[1], 190, 54, e0, d))
        b.append(cap(text, s0, round(s0 + .045, 3) if k < 4 else round(start + .27, 3), d, 450, 330))
b += [cap("Without a framework, every pair of programs invents its own link", 0, .34, d, 450, 330),
      cap("With ROS 2, every program joins one shared graph", .34, .44, d, 450, 330)]
svgs["One robot, many programs"] = svg(340, "Four programs (camera driver, object detector, motion planner, motor controller) first connect through six different custom links; these disappear and every program joins one ROS 2 graph. Data then flows from the robot camera through each program to the motors, and the robot arm moves.", "".join(b), " tall") \
    + legend(("req", "image / objects"), ("fb", "action goal"), ("res", "motor commands"))

# ---------- The ROS 2 mental model: the graph builds up, the CLI sees it ----------
d = "18s"
def rnode(cx, cy, name, t):   # rqt_graph style: nodes are ellipses
    return (f'<g opacity="0"><ellipse class="node" cx="{cx}" cy="{cy}" rx="72" ry="26"/><text class="s" x="{cx}" y="{cy}">{name}</text>{vis(t, 1, d)}</g>')
def rtopic(cx, cy, name, typ, t):   # topics are boxes
    return (f'<g opacity="0"><rect class="pill topic" x="{cx - 70}" y="{cy - 17}" width="140" height="34" rx="4"/><text class="s" x="{cx}" y="{cy}">{name}</text>'
            f'<text class="msgtype" x="{cx}" y="{cy + 30}">{typ}</text>{vis(t, 1, d)}</g>')
def edge(path, t):
    return f'<path class="edge" d="{path}" opacity="0" marker-end="url(#mm-arrow)">{vis(t, 1, d)}</path>'
b = ['<defs><marker id="mm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow-head"/></marker></defs>',
     rnode(85, 80, "/camera", .02), rnode(395, 80, "/detector", .06), rnode(545, 240, "/planner", .10),
     edge("M157,80 L178,80", .14), rtopic(248, 80, "/image_raw", "sensor_msgs/msg/Image", .14), edge("M318,80 L321,80", .15),
     edge("M467,80 L478,80", .18), rtopic(548, 80, "/detections", "vision_msgs/msg/Detection2DArray", .18), edge("M548,124 L548,212", .19),
     rnode(285, 240, "/logger", .62), edge("M500,112 C440,160 360,190 318,216", .63)]
for st in (.24, .32, .40, .48, .56):
    b += [packet("req", "M157,80 L318,80", st, st + .035, d), flash(323, 54, 144, 52, st + .035, d, 26),
          packet("req", "M467,80 L548,80 L548,212", st + .04, st + .075, d), flash(473, 214, 144, 52, st + .075, d, 26)]
for st in (.66, .74, .82, .90):
    b += [packet("req", "M157,80 L318,80", st, st + .035, d),
          packet("req", "M467,80 L548,80 L548,212", st + .04, st + .075, d), packet("req", "M467,80 L548,80 C440,160 360,190 318,216", st + .04, st + .075, d),
          flash(473, 214, 144, 52, st + .075, d, 26), flash(213, 214, 144, 52, st + .075, d, 26)]
b.append(term(660, 14, 230, 300, "terminal"))
T = [("type", "$ ros2 node list", .11), ("show", "/camera", .13), ("show", "/detector", .13), ("show", "/planner", .13), ("show", "/logger", .64),
     ("type", "$ ros2 topic list", .2), ("show", "/detections", .22), ("show", "/image_raw", .22), ("show", "/parameter_events", .22), ("show", "/rosout", .22)]
for i, (kind, text, t0) in enumerate(T):
    y = 56 + i * 24 + (10 if i >= 5 else 0)
    b.append(typed(674, y, text, t0, d, .025) if kind == "type" else shown(674, y, text, t0, d, 1, "code ok" if text == "/logger" else "code"))
b += [cap("nodes: one program, one job", 0, .14, d, 320, 318), cap("topics join publishers to subscribers, with a message type", .14, .24, d, 320, 318),
      cap("messages flow; nobody addresses anyone directly", .24, .62, d, 320, 318), cap("a new subscriber joins; the publisher does not change", .62, 1, d, 320, 318)]
svgs["The ROS 2 mental model"] = svg(330, "An rqt_graph-style graph builds up: the /camera, /detector and /planner nodes appear, joined by the /image_raw and /detections topics with their message types, and messages flow. A terminal lists the same nodes and topics, plus /parameter_events and /rosout. A /logger node then joins and also receives /detections.", "".join(b), " tall")

# ---------- Inside a robot (divider): the sense, think, act loop ----------
d = "6s"
b = []
for x, kind, name, sub in ((90, "sense", "Sense", "sensors measure"), (360, "think", "Think", "a computer decides"), (630, "act", "Act", "motors move")):
    b.append(f'<rect class="pill" x="{x}" y="40" width="180" height="64" rx="32"/><text class="s" x="{x + 90}" y="64">{name}</text><text class="k" x="{x + 90}" y="86">{sub}</text>')
b += [wire("M270,72 L360,72"), wire("M540,72 L630,72"), '<path class="trail" d="M720,104 C720,190 180,190 180,104"/>',
      '<text class="k" x="450" y="196">the world changes · repeat</text>',
      packet("req", "M270,72 L360,72", .02, .2, d), flash(360, 40, 180, 64, .2, d, 32),
      packet("fb", "M540,72 L630,72", .34, .52, d), flash(630, 40, 180, 64, .52, d, 32),
      packet("res", "M720,104 C720,190 180,190 180,104", .6, .95, d), flash(90, 40, 180, 64, .95, d, 32)]
svgs["Inside a robot"] = svg(210, "A loop of three stages: sense, where sensors measure; think, where a computer decides; act, where motors move. A packet travels from sense to think to act, then around a return path labelled the world changes, back to sense.", "".join(b))

# ======================================================================
# Concept diagrams (Day 1). Each replaces a static diagram on a hand-written slide.
# ======================================================================
def at(inner, s0, e0, dur):
    return f'<g opacity="0">{inner}{vis(s0, e0, dur)}</g>'

def burst(x, y, t, dur, cls="bad", r1=26):
    t = max(t, .002); a = min(t + .07, .998)
    return (f'<circle class="burst {cls}" cx="{x}" cy="{y}" r="4" opacity="0"><animate attributeName="r" dur="{dur}" repeatCount="indefinite" values="4;4;{r1};{r1}" keyTimes="0;{t};{a};1"/>'
            f'<animate attributeName="opacity" dur="{dur}" repeatCount="indefinite" values="0;0;1;0;0" keyTimes="0;{t};{min(t + .005, .997)};{a};1"/></circle>')

def box(x, y, w, h, title, sub="", cls="node", rx=6):
    return (f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>'
            + (f'<text class="s" x="{x + w / 2}" y="{y + h / 2 - (8 if sub else 0)}">{title}</text>' if title else '')
            + (f'<text class="k" x="{x + w / 2}" y="{y + h / 2 + 11}">{sub}</text>' if sub else ''))

# ---------- What is DDS?: a message down one stack, across the wire, up the other ----------
d = "7s"
LAY = [("rclpy / rclcpp", "your code"), ("rcl + rmw", "ROS middleware API"), ("DDS", "discovery · QoS"), ("RTPS", "UDP / shared memory")]
b = []
for col, (x, who) in enumerate(((20, "publisher process"), (270, "subscriber process"))):
    b.append(f'<text class="k" x="{x + 85}" y="16">{who}</text>')
    for i, (n, sub) in enumerate(LAY):
        y = 30 + i * 66
        b.append(box(x, y, 170, 52, n, sub, "block app" if i == 0 else "block"))
        t = (.06 + i * .09) if col == 0 else (.62 - i * .09)
        b.append(flash(x, y, 170, 52, round(t, 3), d))
b += [wire("M105,82 L105,96"), wire("M105,148 L105,162"), wire("M105,214 L105,228"), wire("M355,82 L355,96"), wire("M355,148 L355,162"), wire("M355,214 L355,228"),
      '<path class="wire" d="M105,282 L105,300 L355,300 L355,282"/>', '<text class="k" x="230" y="318">network · UDP</text>',
      '<path class="trail" d="M190,186 C230,170 230,170 270,186"/>',
      packet("req", "M105,56 L105,256 L105,300 L355,300 L355,256 L355,56", .04, .66, d),
      cap("serialize · hand to DDS · send over RTPS", .04, .36, d, 230, 345), cap("deliver · deserialize · run the callback", .36, .7, d, 230, 345),
      cap("discovery found the subscriber first: no broker", .7, 1, d, 230, 345)]
for t0 in (.72, .82, .92):
    b.append(packet("fb", "M190,186 C230,170 230,170 270,186", t0, round(t0 + .06, 3), d))
svgs["What is DDS?"] = svg(355, "Two stacks of layers, rclpy, rcl and rmw, DDS, and RTPS, for a publisher and a subscriber. A message travels down the publisher stack, across the network over UDP, and up the subscriber stack; then discovery messages pass between the two DDS layers.", "".join(b), " tall", vb_w=460)

# ---------- Names, namespaces, and domains ----------
d = "9s"
b = [box(20, 20, 560, 200, "", cls="node", rx=14), '<text class="k" x="300" y="40">ROS_DOMAIN_ID=7 · one graph</text>',
     box(620, 20, 260, 200, "", cls="node", rx=14), '<text class="k" x="750" y="40">ROS_DOMAIN_ID=12 · separate graph</text>']
CAMS = [(60, 80, "/robot_1/camera"), (60, 150, "/robot_2/camera")]
for x, y, n in CAMS: b.append(box(x, y, 190, 44, n, "", "pill"))
b.append(box(380, 112, 160, 44, "rviz2", "", "pill topic"))
b.append(box(655, 112, 190, 44, "/robot_1/camera", "", "pill"))
b += [ring(155, 102, .02, .12, d, 20, 200), ring(750, 134, .02, .12, d, 20, 120),
      '<path class="trail" d="M250,102 L380,128"/><path class="trail" d="M250,172 L380,140"/>']
for k in range(5):
    t0 = round(.16 + k * .15, 3)
    b += [packet("req", "M250,102 L380,128", t0, round(t0 + .07, 3), d), packet("fb", "M250,172 L380,140", round(t0 + .04, 3), round(t0 + .11, 3), d)]
b += [packet("req", "M845,134 L870,134 L870,250 L460,250 L460,156", .3, .45, d), burst(600, 250, .38, d)]
b += [cap("discovery stays inside a domain", 0, .16, d, 450, 262), cap("namespaces keep two cameras apart in one graph", .16, .3, d, 450, 262),
      cap("same name in domain 12: invisible to domain 7", .3, .6, d, 450, 262), cap("namespace organizes names · domain separates graphs", .6, 1, d, 450, 262)]
svgs["Names, namespaces, and domains"] = svg(272, "Domain 7 holds /robot_1/camera and /robot_2/camera publishing to rviz2. Domain 12 holds another /robot_1/camera; its messages stop at the domain boundary, so rviz2 never sees them.", "".join(b), " tall")

# ---------- Quality of Service: four policies, four small stories ----------
d = "10s"
b = []
P = [(10, "Reliability"), (232, "History · keep last 3"), (454, "Durability"), (676, "Deadline · 1 s")]
for x, n in P: b += [box(x, 10, 214, 250, "", cls="node", rx=10), f'<text class="s" x="{x + 107}" y="34">{n}</text>']
# reliability: best effort loses #3; reliable resends it
x = 10
for row, (lbl, y, cls) in enumerate((("best effort", 90, "req"), ("reliable", 170, "res"))):
    b += [f'<text class="k" x="{x + 107}" y="{y - 26}">{lbl}</text>', f'<circle class="joint" cx="{x + 24}" cy="{y}" r="7"/>', f'<circle class="joint" cx="{x + 190}" cy="{y}" r="7"/>', f'<path class="trail" d="M{x + 32},{y} L{x + 182},{y}"/>']
    for k in range(6):
        t0 = round(.05 + k * .14, 3)
        if k == 2:
            b += [packet(cls, f"M{x + 32},{y} L{x + 107},{y}", t0, round(t0 + .05, 3), d), burst(x + 107, y, round(t0 + .05, 3), d)]
            if row: b += [packet(cls, f"M{x + 32},{y} L{x + 182},{y}", round(t0 + .12, 3), round(t0 + .22, 3), d), at(f'<text class="cap" x="{x + 107}" y="{y + 26}">resent</text>', round(t0 + .12, 3), round(t0 + .25, 3), d)]
        else: b.append(packet(cls, f"M{x + 32},{y} L{x + 182},{y}", t0, round(t0 + .1, 3), d))
b.append(f'<text class="k" x="{x + 107}" y="236">fresh vs complete</text>')
# history: three slots, oldest falls out
x = 232
for i in range(3): b.append(f'<rect class="block" x="{x + 22 + i * 60}" y="110" width="50" height="40" rx="5"/>')
for k in range(7):
    s0, e0 = round(.05 + k * .13, 3), round(.05 + (k + 1) * .13, 3) if k < 6 else 1
    vals = [v for v in range(k - 2, k + 1) if v >= 0]
    inner = "".join(f'<text class="code" x="{x + 33 + i * 60}" y="131">#{v}</text>' for i, v in enumerate(vals))
    if k >= 3: inner += f'<text class="code hot" x="{x + 30}" y="186">#{k - 3} dropped</text>'
    b.append(at(inner, s0, e0, d))
b += [f'<text class="k" x="{x + 107}" y="86">queue depth 3</text>', f'<text class="k" x="{x + 107}" y="236">newest N kept</text>']
# durability: a late subscriber
x = 454
b += [f'<circle class="joint" cx="{x + 30}" cy="140" r="8"/>', f'<text class="k" x="{x + 30}" y="166">/map</text>',
      f'<text class="k" x="{x + 150}" y="70">volatile</text>', f'<text class="k" x="{x + 150}" y="196">transient local</text>',
      packet("res", f"M{x + 38},140 L{x + 100},140", .06, .14, d), at(f'<text class="cap" x="{x + 110}" y="124">published once</text>', .06, .3, d),
      at(f'<circle class="joint" cx="{x + 180}" cy="96" r="7"/><circle class="joint" cx="{x + 180}" cy="170" r="7"/><text class="k" x="{x + 180}" y="120">late sub</text>', .4, 1, d),
      at(f'<text class="code hot" x="{x + 120}" y="100">nothing</text>', .5, 1, d),
      packet("res", f"M{x + 38},140 L{x + 172},170", .5, .62, d), at(f'<text class="code ok" x="{x + 120}" y="228">gets the map</text>', .62, 1, d)]
# deadline: messages every second, one is late
x = 676
b += [f'<line class="divider" x1="{x + 16}" y1="140" x2="{x + 198}" y2="140"/>']
for k in range(7):
    t0 = round(.08 + k * .12, 3)
    px = x + 22 + k * 28
    b.append(f'<line class="divider" x1="{px}" y1="120" x2="{px}" y2="160"/>')
    if k != 4: b.append(at(f'<circle class="pulse" cx="{px}" cy="140" r="6"/>', t0, 1, d))
    else: b += [burst(px, 140, round(t0 + .02, 3), d), at(f'<text class="code hot" x="{x + 40}" y="196">deadline missed</text>', round(t0 + .02, 3), 1, d)]
b += [f'<text class="k" x="{x + 107}" y="96">expected every 1 s</text>', f'<text class="k" x="{x + 107}" y="236">event callback fires</text>']
svgs["Quality of Service"] = svg(268, "Four panels. Reliability: best effort loses message 2 while reliable resends it. History keep last 3: a three-slot queue keeps the newest messages and drops the oldest. Durability: a late subscriber gets nothing with volatile but receives the stored map with transient local. Deadline: one message misses its 1 second period and an event fires.", "".join(b), " tall")

# ---------- QoS compatibility: mismatch, then the fix ----------
d = "10s"
b = [box(30, 40, 220, 70, "/lidar_driver", "offers best effort", "node"), at(box(650, 40, 220, 70, "/my_listener", "requests reliable", "node"), 0, .5, d),
     at(box(650, 40, 220, 70, "/my_listener", "requests best effort", "node"), .5, 1, d), '<path class="trail" d="M250,75 L650,75"/>', '<text class="k" x="450" y="60">/scan</text>']
for k in range(4):
    t0 = round(.04 + k * .1, 3)
    b += [packet("req", "M250,75 L560,75", t0, round(t0 + .06, 3), d), burst(570, 75, round(t0 + .06, 3), d)]
b.append(at('<line class="xmark" x1="595" y1="60" x2="625" y2="90"/><line class="xmark" x1="625" y1="60" x2="595" y2="90"/>', .04, .5, d))
for k in range(4):
    t0 = round(.56 + k * .1, 3)
    b += [packet("req", "M250,75 L650,75", t0, round(t0 + .07, 3), d), flash(650, 40, 220, 70, round(t0 + .07, 3), d)]
b += [term(30, 130, 840, 74, "terminal"),
      typed(46, 168, "[WARN] New publisher discovered on topic '/scan', offering incompatible QoS. No messages will be received from it.", .1, d, .1, .5, "code hot"),
      typed(46, 190, "Last incompatible policy: RELIABILITY", .22, d, .04, .5, "code hot"),
      typed(46, 168, "$ ros2 topic echo /scan --qos-reliability best_effort", .52, d, .06, 1, "code"),
      at('<text class="code ok" x="46" y="190">header: stamp: … ranges: [1.02, 1.03, 1.01, …]</text>', .62, 1, d),
      cap("best effort offered, reliable requested: no match, no data", 0, .5, d, 450, 228), cap("fix: request best effort (or offer reliable)", .5, 1, d, 450, 228)]
svgs["QoS compatibility"] = svg(238, "A lidar driver offers best effort on /scan. A listener requesting reliable receives nothing; each message stops before it and the terminal shows the incompatible QoS warning. The listener then requests best effort and every message arrives.", "".join(b))

# ---------- Workspaces and overlays: who answers a package lookup ----------
d = "12s"
L3 = [(30, "Overlay", "~/ros2_ws/install", "workshop_runtime · demo_nodes_py"), (100, "Underlay", "/opt/ros/jazzy", "turtlesim · demo_nodes_py · rclpy"), (170, "Operating system", "Ubuntu 24.04", "Python · libraries")]
b = []
for y, k, n, pk in L3:
    b += [f'<rect class="block{" app" if k == "Overlay" else ""}" x="300" y="{y}" width="580" height="56" rx="6"/>', f'<text class="k left" x="316" y="{y + 18}">{k}</text>', f'<text class="s left" x="316" y="{y + 40}">{n}</text>', f'<text class="code left" x="560" y="{y + 34}">{pk}</text>']
Q = [("ros2 run workshop_runtime …", 0, .03, "found in the overlay"), ("ros2 run turtlesim …", 1, .36, "not in the overlay, found in the underlay"), ("ros2 run demo_nodes_py …", 0, .69, "in both: the overlay wins (shadows)")]
for text, layer, t0, msg in Q:
    y = (58 if layer == 0 else 128)
    b += [typed(20, 60, text.replace("…", ""), t0, d, .04, round(t0 + .31, 3), "code"),
          packet("req", f"M200,52 L290,52 L290,{y}", round(t0 + .05, 3), round(t0 + .12 + layer * .06, 3), d),
          flash(300, 30 + layer * 70, 580, 56, round(t0 + .12 + layer * .06, 3), d), cap(msg, round(t0 + .12, 3), round(t0 + .32, 3), d, 450, 245)]
    if layer: b.append(at('<text class="code hot left" x="20" y="118">overlay: no</text>', round(t0 + .08, 3), round(t0 + .31, 3), d))
svgs["Workspaces and overlays"] = svg(255, "Three layers: the overlay ~/ros2_ws/install, the underlay /opt/ros/jazzy, and the operating system. A lookup for workshop_runtime is answered by the overlay, turtlesim falls through to the underlay, and demo_nodes_py, in both, is answered by the overlay, which shadows the underlay.", "".join(b))

# ---------- Timers schedule callbacks: one long callback delays the next ----------
d = "8s"
b = ['<text class="k left" x="10" y="40">timer</text>', '<text class="k left" x="10" y="110">thread</text>', '<line class="divider" x1="70" y1="60" x2="450" y2="60"/>', '<line class="divider" x1="70" y1="130" x2="450" y2="130"/>']
X = lambda sec: 70 + sec * 120   # 0..3.1 s
RUNS = [(0, .12), (.5, .62), (1.0, 1.75), (1.75, 1.87), (2.0, 2.12), (2.5, 2.62), (3.0, 3.1)]
for k, (st, en) in enumerate(RUNS):
    due = k * .5 if k < 7 else st
    tf = round(.03 + due / 3.2 * .9, 3); ts = round(.03 + st / 3.2 * .9, 3)
    b.append(at(f'<line class="xmark" style="stroke:var(--cyan);stroke-width:3" x1="{X(due)}" y1="48" x2="{X(due)}" y2="72"/>', tf, 1, d))
    cls = "bad" if en - st > .3 else "req"
    b.append(at(f'<rect class="{cls}" x="{X(st)}" y="116" width="{max((en - st) * 120, 6)}" height="28" rx="3"/>', ts, 1, d))
    if k == 3: b.append(at(f'<path class="trail" d="M{X(1.5)},72 L{X(1.75)},116"/><text class="code hot" x="{X(1.4)}" y="96">0.25 s late</text>', ts, 1, d))
b += [at(f'<text class="code hot" x="{X(1.38)}" y="164">long callback</text>', .32, 1, d),
      f'<line stroke="var(--orange)" stroke-width="2" x1="70" y1="30" x2="70" y2="150"><animate attributeName="x1" dur="{d}" repeatCount="indefinite" values="70;70;450;450" keyTimes="0;.03;.93;1"/><animate attributeName="x2" dur="{d}" repeatCount="indefinite" values="70;70;450;450" keyTimes="0;.03;.93;1"/></line>',
      cap("ready every 0.5 s · run when the thread is free", 0, 1, d, 260, 190)]
svgs["Timers schedule callbacks"] = svg(200, "A timer fires every 0.5 seconds and a single executor thread runs each short callback. The third callback runs long, so the fourth starts a quarter of a second late.", "".join(b), vb_w=460)

# ---------- write into index.html ----------
TALL = {"ROS 2 distributions over time", "History of ROS and ROS 2", "ROS 1 vs ROS 2 architecture", "ROS 1 vs ROS 2 software stack", "Turtlesim demo: topics", "Turtlesim demo: services",
        "Turtlesim demo: actions", "Turtlesim demo: parameters", "Turtlesim demo: launch", "Turtlesim demo: ros2 bag"}
svgs["Links and joints"] = urdf_svg
svgs["Simulation loop"] = gz_svg


def section_bounds(html, title):
    i = html.index(f'data-title="{title}"')
    start = html.rindex("    <section", 0, i)
    end = html.index("</section>\n", i) + len("</section>\n")
    return start, end + 1 if html[end:end + 1] == "\n" else end


def build(html):
    for section in list(out.values()) + list(demo.values()):
        title = re.search(r'data-title="([^"]*)"', section).group(1)
        if title in TALL:
            section = section.replace('<svg class="ros-anim"', '<svg class="ros-anim tall"', 1)
        start, end = section_bounds(html, title)
        html = html[:start] + section + html[end:]
    for title, diagram in svgs.items():
        start, end = section_bounds(html, title)
        new, n = re.subn(r'      <svg class="ros-anim.*?</svg>\n(      <div class="anim-legend">.*?</div>\n)?',
                         lambda m: diagram, html[start:end], count=1, flags=re.S)
        assert n == 1, f"no diagram found on slide {title!r}"
        html = html[:start] + new + html[end:]
    return html


if __name__ == "__main__":
    index = Path(__file__).resolve().parents[2] / "index.html"
    current = index.read_text()
    updated = build(current)
    if "--check" in sys.argv:
        sys.exit(0 if updated == current else "index.html is out of date: run python3 tools/animations/build.py")
    index.write_text(updated)
    print("index.html updated" if updated != current else "index.html already up to date")
