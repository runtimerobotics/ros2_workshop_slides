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

def svg(vb_h, label, body, extra_cls=""):
    return (f'      <svg class="ros-anim{extra_cls}" viewBox="0 0 900 {vb_h}" role="img" aria-label="{label}">\n        '
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


# ---------- write into index.html ----------
TALL = {"ROS 1 vs ROS 2 architecture", "ROS 1 vs ROS 2 software stack", "Turtlesim demo: topics", "Turtlesim demo: services",
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
