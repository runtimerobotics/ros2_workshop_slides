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

def svg(vb_h, label, body, extra_cls="", vb_w=900, trace=None, trace_pre=0):
    # trace: [(cycle fraction, "first-last line"), ...] highlights lines of the slide's code block in step with the animation
    tr = (f' data-trace="{";".join(f"{f}:{l}" for f, l in trace)}"' + (f' data-trace-pre="{trace_pre}"' if trace_pre else "")) if trace else ""
    return (f'      <svg class="ros-anim{extra_cls}" viewBox="0 0 {vb_w} {vb_h}" role="img" aria-label="{label}"{tr}>\n        '
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

# ======================================================================
# Concept diagrams (Day 2)
# ======================================================================
import math

def pill(cx, cy, text, w=140, cls="pill", h=40):
    return f'<rect class="{cls}" x="{cx - w / 2}" y="{cy - h / 2}" width="{w}" height="{h}" rx="{h / 2}"/><text class="s" x="{cx}" y="{cy}">{text}</text>'

def axes2d(x, y, ang, L=46, lbl=""):
    # x axis (pink) at angle ang (degrees, SVG y down), y axis (cyan) 90° counter-clockwise
    a = math.radians(ang); bx, by = x + L * math.cos(a), y - L * math.sin(a); cx, cy = x - L * math.sin(a), y - L * math.cos(a)
    return (f'<line class="ax-x" x1="{x}" y1="{y}" x2="{bx:.1f}" y2="{by:.1f}"/><line class="ax-y" x1="{x}" y1="{y}" x2="{cx:.1f}" y2="{cy:.1f}"/>'
            f'<circle class="joint" cx="{x}" cy="{y}" r="4"/><text class="code" x="{bx + 4:.1f}" y="{by + 4:.1f}">x</text><text class="code" x="{cx - 4:.1f}" y="{cy - 6:.1f}">y</text>'
            + (f'<text class="k" x="{x}" y="{y + 22}">{lbl}</text>' if lbl else ''))

# ---------- A tree of coordinate frames ----------
d = "12s"
F = {"map": (70, 125), "odom": (250, 125), "base_link": (440, 125), "lidar_link": (700, 45), "camera_link": (700, 125), "tool0": (700, 205)}
E = [("map", "odom", "res", "localization · /tf"), ("odom", "base_link", "req", "odometry · /tf"), ("base_link", "lidar_link", "fb", ""), ("base_link", "camera_link", "fb", ""), ("base_link", "tool0", "fb", "")]
b = []
for p_, c, cls, lbl in E:
    (x1, y1), (x2, y2) = F[p_], F[c]
    path = f"M{x1 + 70},{y1} L{x2 - 70},{y2}" if y1 == y2 else f"M{x1 + 70},{y1} C{x1 + 140},{y1} {x2 - 150},{y2} {x2 - 70},{y2}"
    b.append(f'<path class="wire" d="{path}"/>')
    if lbl: b.append(f'<text class="k" x="{(x1 + x2) / 2}" y="{y1 - 30}">{lbl}</text>')
    if cls == "fb": b.append(packet("fb", path, .02, .1, d))
    elif cls == "req":
        for k in range(10): t0 = round(.12 + k * .085, 3); b.append(packet("req", path, t0, round(t0 + .05, 3), d))
    else:
        for t0 in (.2, .55, .85): b.append(packet("res", path, t0, round(t0 + .06, 3), d))
b.append('<text class="k" x="560" y="246">robot_state_publisher · /tf_static (once)</text>')
for n, (x, y) in F.items(): b.append(pill(x, y, n, 140, "pill topic" if n in ("lidar_link", "camera_link", "tool0") else "pill"))
CH = "M70,125 L250,125 L440,125 C580,125 560,125 630,125 L700,125"
b += [f'<path d="{CH}" fill="none" stroke="var(--orange)" stroke-width="6" stroke-linecap="round" opacity="0">{vis(.62, .95, d)}</path>',
      flash(0, 105, 140, 40, .62, d, 20), flash(630, 105, 140, 40, .66, d, 20),
      cap("static mounts: published once on /tf_static", 0, .12, d, 450, 280), cap("odometry streams odom → base_link; localization corrects map → odom", .12, .6, d, 450, 280),
      cap("lookup_transform('map', 'camera_link'): three transforms chained", .6, 1, d, 450, 280)]
svgs["A tree of coordinate frames"] = svg(290, "A frame tree: map to odom to base_link, which has three children, lidar_link, camera_link and tool0. Static transforms to the children are published once; odom to base_link streams continuously and map to odom updates now and then. Finally the chain from map to camera_link lights up as one lookup.", "".join(b), " tall")

# ---------- Coordinate axes and rotation ----------
d = "10s"
b = [axes2d(200, 180, 0, 70, "base_link"), '<circle cx="200" cy="180" r="9" fill="none" stroke="var(--blue)" stroke-width="2"/><text class="code" x="214" y="206">z ⊙ up</text>']
cam = (f'<g>{axes2d(0, 0, 0, 56)}<rect class="block app" x="-14" y="-10" width="28" height="20" rx="3"/>'
       f'<animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;{EASE};0 0 1 1;{EASE}" values="0;0;-90;-90;0" keyTimes="0;.42;.6;.92;1"/></g>')
b.append(f'<g transform="translate(200 180)"><g>{cam}<animateTransform attributeName="transform" type="translate" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;{EASE};0 0 1 1;{EASE}" values="0 0;0 0;260 -90;260 -90;0 0" keyTimes="0;.1;.3;.92;1"/></g></g>')
b += [at('<text class="k" x="460" y="58">camera_link</text>', .3, .92, d),
      '<path class="trail" d="M200,180 L460,90"/>',
      term(600, 40, 290, 150, "static transform"),
      typed(614, 84, "x  0.26  (forward)", .12, d, .05), typed(614, 108, "y  0.09  (left)", .18, d, .05), typed(614, 132, "z  0.30  (up)", .24, d, .05),
      typed(614, 166, "yaw  -1.571  (-90°)", .5, d, .05, None, "code hot"),
      cap("translate: where the frame's origin is", .05, .4, d, 450, 252), cap("rotate: which way its axes point · right-hand rule about z", .4, .92, d, 450, 252)]
svgs["Coordinate axes and rotation"] = svg(262, "Top view of base_link axes, x forward and y left, with z up out of the page. A camera_link frame moves to 0.26 m forward, 0.09 m left and 0.30 m up, then rotates -90 degrees about z; a panel lists the translation and the yaw.", "".join(b), " tall")

# ---------- Static and dynamic transforms ----------
d = "10s"
b = [box(10, 10, 430, 230, "", cls="node", rx=10), '<text class="s" x="225" y="34">/tf_static · fixed mounting</text>',
     box(460, 10, 430, 230, "", cls="node", rx=10), '<text class="s" x="675" y="34">/tf · changing pose</text>',
     pill(110, 90, "publisher", 150), box(270, 66, 150, 48, "latched", "transient local", "block app"),
     packet("fb", "M185,90 L270,90", .05, .12, d), at('<text class="code ok" x="200" y="132">published once</text>', .12, .45, d),
     at(pill(110, 190, "rviz2", 120), .02, 1, d), packet("fb", "M345,114 L345,190 L170,190", .14, .24, d),
     at(pill(345, 190, "late node", 130, "pill topic"), .55, 1, d), packet("fb", "M345,114 L345,170", .6, .68, d), flash(280, 170, 130, 40, .68, d, 20),
     at('<text class="code ok" x="230" y="226">a late joiner still gets it</text>', .68, 1, d)]
# dynamic: a wheel turning, stamped messages streaming
b += [f'<g transform="translate(560 120)"><g><circle class="wheel" r="34"/><line x1="0" y1="0" x2="30" y2="0" stroke="var(--cyan)" stroke-width="3"/>'
      f'<animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" values="0;1440"/></g></g>',
      '<text class="k" x="560" y="176">wheel_joint</text>', '<path class="trail" d="M600,120 L860,120"/>']
for k in range(14):
    t0 = round(.02 + k * .066, 3)
    b.append(packet("req", "M600,120 L860,120", t0, round(t0 + .1, 3), d))
    b.append(at(f'<text class="code" x="700" y="{205}">stamp {12.0 + k * .05:.2f} s</text>', round(t0 + .1, 3), round(t0 + .166, 3) if k < 13 else 1, d))
b.append('<text class="k" x="760" y="100">every update, timestamped</text>')
svgs["Static and dynamic transforms"] = svg(250, "Left: a static transform is published once, held with transient local durability, and delivered to rviz2 and to a node that joins later. Right: a turning wheel joint publishes transforms continuously, each with a new timestamp.", "".join(b), " tall")

# ---------- One link, three models ----------
d = "8s"
LINK = "M-60,-14 L40,-18 Q62,-18 64,0 Q62,18 40,18 L-60,14 Q-74,0 -60,-14 Z"
b = [box(10, 10, 280, 220, "", cls="node", rx=10), box(310, 10, 280, 220, "", cls="node", rx=10), box(610, 10, 280, 220, "", cls="node", rx=10),
     '<text class="s" x="150" y="34">Visual</text><text class="s" x="450" y="34">Collision</text><text class="s" x="750" y="34">Inertial</text>']
# visual: detailed shape, gently turning
b.append(f'<g transform="translate(150 125)"><g><path d="{LINK}" fill="rgba(106,168,255,.35)" stroke="var(--blue)" stroke-width="2"/>'
         '<circle cx="-50" cy="0" r="7" fill="none" stroke="var(--ink)"/><circle cx="46" cy="0" r="9" fill="none" stroke="var(--ink)"/>'
         '<path d="M-30,-8 L20,-10 M-30,8 L20,10" stroke="rgba(255,255,255,.35)"/>'
         f'<animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" values="-12;12;-12"/></g></g>')
# collision: simple boxes; a ball bounces on them
b += [f'<path d="{LINK}" transform="translate(450 150)" fill="none" stroke="rgba(255,255,255,.2)"/>',
      '<rect x="384" y="134" width="132" height="32" rx="4" fill="rgba(255,177,90,.3)" stroke="var(--orange)" stroke-width="2"/>',
      f'<circle class="res" cx="450" cy="60" r="10"><animate attributeName="cy" dur="1.6s" repeatCount="indefinite" calcMode="spline" keySplines=".5 0 1 1;0 0 .5 1" values="60;124;60" keyTimes="0;.5;1"/></circle>',
      '<text class="k" x="450" y="200">simple shape · fast contact</text>']
# inertial: a pendulum about the joint, centre of mass marked
b += [f'<g transform="translate(700 70)"><g><path d="{LINK}" transform="translate(66 0)" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.3)"/>'
      '<circle cx="62" cy="0" r="7" fill="var(--pink)"/><ellipse cx="62" cy="0" rx="34" ry="14" fill="none" stroke="var(--pink)" stroke-dasharray="4 3"/>'
      '<text class="code" x="50" y="34">m = 1.2 kg</text>'
      f'<animateTransform attributeName="transform" type="rotate" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines=".4 0 .6 1;.4 0 .6 1" values="20;160;20" keyTimes="0;.5;1"/></g></g>',
      '<circle class="joint" cx="700" cy="70" r="6"/>', '<text class="k" x="750" y="218">mass · centre · inertia</text>']
svgs["One link, three models"] = svg(240, "Three views of the same link. Visual: a detailed shape, gently turning. Collision: a simple box that a ball bounces on. Inertial: the link swings like a pendulum about its joint, with its centre of mass and inertia ellipse marked.", "".join(b), " tall")

# ---------- From URDF to TF ----------
d = "10s"
b = [term(10, 20, 200, 120, "arm.urdf.xacro"), shown(22, 60, "&lt;link name=\"link1\"/&gt;", 0, d), shown(22, 82, "&lt;joint type=\"revolute\"&gt;", 0, d), shown(22, 104, "&lt;xacro:arm .../&gt;", 0, d),
     pill(320, 80, "robot_description", 170, "pill topic"), pill(530, 80, "robot_state_publisher", 200), pill(530, 200, "/joint_states", 160, "pill topic"),
     pill(760, 80, "/tf · /tf_static", 160, "pill topic"),
     box(30, 170, 170, 70, "", cls="block", rx=6), '<text class="k" x="115" y="186">joint_state_publisher_gui</text>', '<line x1="50" y1="214" x2="180" y2="214" stroke="var(--line)" stroke-width="4"/>',
     wire("M210,80 L235,80"), wire("M405,80 L430,80"), wire("M630,80 L680,80"), wire("M200,214 L450,200"), wire("M530,180 L530,100")]
KEYS = "0;.25;.5;.75;1"
b.append(f'<circle class="pulse" cx="115" cy="214" r="9"><animate attributeName="cx" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="{EASE};{EASE};{EASE};{EASE}" values="70;160;90;150;70" keyTimes="{KEYS}"/></circle>')
b += [packet("fb", "M210,80 L235,80", .02, .06, d), packet("fb", "M405,80 L430,80", .07, .11, d)]
for k in range(10):
    t0 = round(.12 + k * .085, 3)
    b += [packet("req", "M200,214 L450,200", t0, round(t0 + .04, 3), d), packet("req", "M530,180 L530,100", round(t0 + .04, 3), round(t0 + .07, 3), d), packet("res", "M630,80 L680,80", round(t0 + .07, 3), round(t0 + .1, 3), d)]
# RViz arm following the slider
arm = (f'<g transform="translate(760 230)"><rect class="robot-part" x="-20" y="0" width="40" height="8"/><g>'
       '<rect class="arm" x="-5" y="-60" width="10" height="60" rx="5"/><circle class="joint" r="5"/>'
       f'<g transform="translate(0 -60)"><g><rect class="arm" x="-4" y="-46" width="8" height="46" rx="4"/><circle class="joint" r="4"/>'
       f'<animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="{EASE};{EASE};{EASE};{EASE}" values="40;-30;20;-20;40" keyTimes="{KEYS}"/></g></g>'
       f'<animateTransform attributeName="transform" type="rotate" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="{EASE};{EASE};{EASE};{EASE}" values="-40;35;-20;25;-40" keyTimes="{KEYS}"/></g></g>')
b += [arm, '<text class="k" x="760" y="258">RViz2</text>',
      cap("xacro expands the file into one URDF string", 0, .12, d, 450, 280), cap("move a joint: /joint_states → robot_state_publisher → /tf → RViz", .12, 1, d, 450, 280)]
svgs["From URDF to TF"] = svg(290, "A xacro file becomes the robot_description parameter of robot_state_publisher. A joint_state_publisher_gui slider moves and publishes /joint_states; robot_state_publisher turns them into /tf, and an arm in RViz2 follows the slider.", "".join(b), " tall")

# ---------- URDF, SDF, and the bridge ----------
d = "9s"
b = [box(10, 10, 250, 200, "", cls="node", rx=10), '<text class="s" x="135" y="34">ROS 2</text>', pill(135, 80, "teleop", 150), pill(135, 150, "rviz2", 150),
     box(330, 60, 240, 100, "ros_gz_bridge", "converts message types", "hub", 10),
     box(640, 10, 250, 200, "", cls="node", rx=10), '<text class="s" x="765" y="34">Gazebo</text>', pill(765, 80, "robot · diff drive", 180), pill(765, 150, "gpu_lidar sensor", 180),
     pill(765, 192, "world clock", 130, "pill topic", 26)]
FL = [("M210,80 L330,90", "M570,90 L675,80", "req", .03, "geometry_msgs/msg/Twist", "gz.msgs.Twist", 92),
      ("M675,150 L570,130", "M330,130 L210,150", "res", .36, "gz.msgs.LaserScan", "sensor_msgs/msg/LaserScan", 140),
      ("M700,192 L570,150", "M330,150 L210,186", "fb", .68, "gz.msgs.Clock", "rosgraph_msgs/msg/Clock", 180)]
for p1, p2, cls, t0, a_, b_, y in FL:
    b += [f'<path class="trail" d="{p1}"/><path class="trail" d="{p2}"/>', packet(cls, p1, t0, round(t0 + .08, 3), d), flash(330, 60, 240, 100, round(t0 + .08, 3), d, 10),
          packet(cls, p2, round(t0 + .12, 3), round(t0 + .2, 3), d),
          at(f'<text class="code" x="345" y="196">{a_}</text><text class="code ok" x="345" y="216">→ {b_}</text>', round(t0 + .06, 3), round(t0 + .3, 3), d)]
b += [term(10, 232, 880, 66, "ros2 run ros_gz_bridge parameter_bridge …"), shown(22, 262, "/cmd_vel@geometry_msgs/msg/Twist]gz.msgs.Twist   /clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock", 0, d),
      shown(22, 284, "/scan@sensor_msgs/msg/LaserScan[gz.msgs.LaserScan        ] ROS → Gazebo · [ Gazebo → ROS", 0, d)]
svgs["URDF, SDF, and the bridge"] = svg(304, "ROS 2 on the left, Gazebo on the right, ros_gz_bridge in the middle. /cmd_vel goes from teleop into Gazebo, converted from geometry_msgs Twist to gz.msgs.Twist; the lidar scan and the clock come back, converted into sensor_msgs LaserScan and rosgraph_msgs Clock.", "".join(b), " tall")

# ---------- A sensor is more than geometry ----------
d = "12s"
b = ['<rect class="robot" x="120" y="110" width="140" height="100" rx="14"/>', '<text class="k" x="190" y="196">base_link</text>', axes2d(190, 160, 0, 34),
     '<rect class="block app" x="230" y="70" width="40" height="40" rx="20"/>',
     '<line x1="40" y1="20" x2="40" y2="250" stroke="#3a4566" stroke-width="10"/>', '<line x1="520" y1="20" x2="520" y2="250" stroke="#3a4566" stroke-width="10"/>']
STEPS = [("Pose", "x 0.04  z 0.19 from base_link"), ("Frame ID", "header.frame_id: lidar_link"), ("Update rate", "10 Hz: one scan every 0.1 s"), ("Noise", "σ = 1 cm on every range"), ("Topic type", "/scan · sensor_msgs/msg/LaserScan")]
for i, (k, v) in enumerate(STEPS):
    t0 = round(.02 + i * .19, 3)
    b += [at(f'<rect class="block" x="590" y="{20 + i * 46}" width="300" height="40" rx="5"/><text class="s left" x="604" y="{40 + i * 46}">{k}</text>', t0, 1, d),
          at(f'<text class="code ok" x="700" y="{44 + i * 46}">{v}</text>', round(t0 + .03, 3), 1, d), flash(590, 20 + i * 46, 300, 40, t0, d, 5)]
b += [at('<path class="trail" d="M190,160 L250,90"/><text class="code" x="270" y="140">offset</text>', .02, 1, d),
      at('<text class="code hot" x="250" y="60">lidar_link</text>', .21, 1, d)]
for k in range(5): b.append(ring(250, 90, round(.4 + k * .04, 3), round(.45 + k * .04, 3), d, 20, 70))
import random
rnd = random.Random(4)
pts = "".join(f'<circle class="pulse" cx="{50 + rnd.gauss(0, 3):.1f}" cy="{30 + j * 22}" r="3"/><circle class="pulse" cx="{510 + rnd.gauss(0, 3):.1f}" cy="{30 + j * 22}" r="3"/>' for j in range(10))
b += [at(pts, .59, 1, d), packet("req", "M270,90 L560,90 L560,230", .8, .9, d)]
svgs["A sensor is more than geometry"] = svg(262, "A lidar mounted on a robot between two walls. Five properties appear one by one: its pose offset from base_link, its frame ID lidar_link, a 10 Hz update rate shown as pulses, noise shown as jittered points on the walls, and the /scan topic with type sensor_msgs/msg/LaserScan.", "".join(b), " tall")

# ---------- Reading a LaserScan message ----------
d = "12s"
N, AMIN, AINC = 25, -math.pi / 2, math.pi / 24
OX, OY, SC = 200, 250, 52   # pixels per metre
def ray(a):   # distance to a wall at y = 3.4 m, a box, or inf past 3.5 m
    dx, dy = math.sin(-a), math.cos(a)
    best = 3.5 if abs(dy) < 1e-9 else (3.4 / dy if dy > 0 else 9)
    for (x0, x1, y0, y1) in ((-1.0, -0.4, 1.4, 1.9), (0.9, 1.5, 0.9, 1.3)):
        for t in ((y0 / dy) if dy > 1e-9 else 9, ):
            if x0 <= t * dx <= x1 and 0 < t < best: best = t
        for xs in (x0, x1):
            if abs(dx) > 1e-9:
                t = xs / dx
                if t > 0 and y0 <= t * dy <= y1 and t < best: best = t
    return best if best <= 3.5 else float('inf')
b = [f'<rect x="{OX - 3.6 * SC}" y="{OY - 3.4 * SC - 6}" width="{7.2 * SC}" height="6" fill="#3a4566"/>',
     f'<rect x="{OX - 1.0 * SC}" y="{OY - 1.9 * SC}" width="{.6 * SC}" height="{.5 * SC}" fill="#3a4566"/><rect x="{OX + .9 * SC}" y="{OY - 1.3 * SC}" width="{.6 * SC}" height="{.4 * SC}" fill="#3a4566"/>',
     f'<circle cx="{OX}" cy="{OY}" r="12" class="lidar"/>']
for i in range(N):
    a = AMIN + i * AINC; r = ray(a); s0 = round(.03 + i * .036, 3); e0 = round(s0 + .036, 3)
    dx, dy = math.sin(-a), -math.cos(a)
    L = (r if r != float('inf') else 3.5) * SC
    ex, ey = OX + dx * L, OY + dy * L
    b.append(f'<line x1="{OX}" y1="{OY}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="var(--pink)" stroke-width="2" opacity="0">{vis(s0, e0, d)}</line>')
    if r != float('inf'): b.append(at(f'<circle class="pulse" cx="{ex:.1f}" cy="{ey:.1f}" r="4"/>', s0, 1, d))
    b.append(at(f'<text class="code left" x="400" y="60">i = {i}</text><text class="code left" x="400" y="90">angle = {AMIN:.2f} + {i} × {AINC:.3f}</text>'
                f'<text class="code ok left" x="400" y="114">      = {a:+.2f} rad</text><text class="code left" x="400" y="144">ranges[{i}] = {"inf" if r == float("inf") else f"{r:.2f} m"}</text>', s0, e0 if i < N - 1 else .97, d))
b.append('<text class="k left" x="400" y="180">angle_min −π/2 · increment π/24</text><text class="k left" x="400" y="198">forward is up · + is left</text>')
svgs["Reading a LaserScan message"] = svg(270, "A lidar beam sweeps from right to left through 25 samples. For each index i the panel shows angle equals angle_min plus i times angle_increment and the range read from ranges[i]; hits on a wall and two boxes leave dots, and a sample past the maximum range shows inf.", "".join(b), " tall", vb_w=640)
# ======================================================================
# Concept diagrams (Day 3): two-link arms computed here, played by SMIL
# ======================================================================
def fk2(q1, q2, L1, L2):
    a, b = math.radians(q1), math.radians(q1 + q2)
    e = (L1 * math.cos(a), L1 * math.sin(a))
    return e, (e[0] + L2 * math.cos(b), e[1] + L2 * math.sin(b))

def ik2(x, y, L1, L2, up=True):
    c = (x * x + y * y - L1 * L1 - L2 * L2) / (2 * L1 * L2)
    if abs(c) > 1: return None
    q2 = math.acos(c) * (-1 if up else 1)
    q1 = math.atan2(y, x) - math.atan2(L2 * math.sin(q2), L1 + L2 * math.cos(q2))
    return math.degrees(q1), math.degrees(q2)

def joined(vals): return ";".join(f"{v:.1f}" for v in vals)

def arm2(bx, by, L1, L2, q1s, q2s, kt, dur, cls="arm", tip="", w=(14, 11), spline=False):
    """Planar two-link arm at (bx, by); joint angles in degrees, counter-clockwise, y up."""
    mode = f'calcMode="spline" keySplines="{";".join([EASE] * (len(q1s) - 1))}"' if spline else 'calcMode="linear"'
    rot = lambda qs: f'<animateTransform attributeName="transform" type="rotate" dur="{dur}" repeatCount="indefinite" {mode} values="{joined(-q for q in qs)}" keyTimes="{kt}"/>'
    w1, w2 = w
    return (f'<g transform="translate({bx} {by})"><g><rect class="{cls}" x="0" y="{-w1 / 2}" width="{L1}" height="{w1}" rx="{w1 / 2}"/>'
            f'<g transform="translate({L1} 0)"><g><rect class="{cls}" x="0" y="{-w2 / 2}" width="{L2}" height="{w2}" rx="{w2 / 2}"/>'
            f'<g transform="translate({L2} 0)">{tip}</g><circle class="joint" r="5"/>{rot(q2s)}</g></g><circle class="joint" r="6"/>{rot(q1s)}</g></g>')

def even(n): return ";".join(f"{i / (n - 1):.4f}" for i in range(n))

# ---------- Configuration and task space: a point in joint space moves the tool ----------
d = "12s"
L1, L2, BX, BY = 120, 95, 620, 215
KQ = [(60, -40), (100, -70), (30, 20), (120, -110), (75, -20), (60, -40)]
N = 61
qs = []
for i in range(N):
    u = i / (N - 1) * (len(KQ) - 1); k = min(int(u), len(KQ) - 2); f = u - k
    qs.append((KQ[k][0] + (KQ[k + 1][0] - KQ[k][0]) * f, KQ[k][1] + (KQ[k + 1][1] - KQ[k][1]) * f))
b = ['<rect class="block" x="40" y="20" width="220" height="220" rx="6"/>', '<text class="k" x="150" y="258">q1 →</text>', '<text class="k" x="22" y="130" transform="rotate(-90 22 130)">q2 →</text>',
     '<text class="s" x="150" y="12">joint space</text>', '<text class="s" x="620" y="12">task space</text>']
QX = lambda q1: 40 + (q1 - 0) / 150 * 220; QY = lambda q2: 240 - (q2 + 130) / 170 * 220
b.append(f'<polyline points="{" ".join(f"{QX(a):.1f},{QY(c):.1f}" for a, c in qs)}" fill="none" stroke="rgba(88,224,210,.35)" stroke-width="2" stroke-dasharray="4 4"/>')
b.append(f'<circle class="pulse" r="8"><animate attributeName="cx" dur="{d}" repeatCount="indefinite" values="{joined(QX(a) for a, _ in qs)}" keyTimes="{even(N)}"/>'
         f'<animate attributeName="cy" dur="{d}" repeatCount="indefinite" values="{joined(QY(c) for _, c in qs)}" keyTimes="{even(N)}"/></circle>')
b.append(arm2(BX, BY, L1, L2, [a for a, _ in qs], [c for _, c in qs], even(N), d, tip='<circle class="lidar" r="7"/>'))
b.append(f'<rect class="robot-part" x="{BX - 30}" y="{BY}" width="60" height="12"/>')
for i, (a, c) in enumerate(qs):
    _, (x, y) = fk2(a, c, L1, L2)
    t0 = round(i / (N - 1), 4)
    if 0 < i < N - 1: b.append(f'<circle cx="{BX + x:.1f}" cy="{BY - y:.1f}" r="2.5" fill="var(--orange)" opacity="0">{vis(t0, .99, d)}</circle>')
b += [wire("M290,130 L420,130"), '<path d="M412,124 L422,130 L412,136" fill="var(--blue)"/>', '<text class="k" x="355" y="118">forward kinematics</text>',
      '<text class="code" x="300" y="160">q = [q1, q2]</text><text class="code" x="300" y="184">→ T(base, tool)</text>']
svgs["Configuration and task space"] = svg(268, "Left: a point moves through joint space, the plane of q1 and q2. Right: a two-link arm follows those joint values and its tool tip leaves a trail in task space. Forward kinematics maps each point on the left to one tool position on the right.", "".join(b), " tall")

# ---------- Forward and inverse kinematics: one target, two answers, sometimes none ----------
d = "12s"
L1, L2, BX, BY = 130, 110, 300, 230
TG = [(150, 120), (60, 170), (200, 40), (300, 120), (150, 120)]
up, dn, tx, ty, txt = [], [], [], [], []
for (x, y) in TG:
    a = ik2(x, y, L1, L2, True) or ik2(*(v * (L1 + L2 - 1) / math.hypot(x, y) for v in (x, y)), L1, L2, True)
    c = ik2(x, y, L1, L2, False) or a
    up.append(a); dn.append(c)
kt = "0;.08;.22;.3;.44;.52;.66;.74;.92;1"
def hold(seq): return [v for v in seq[:-1] for _ in (0, 1)] + [seq[-1]] * 2
U1, U2 = hold([q[0] for q in up]), hold([q[1] for q in up]); D1, D2 = hold([q[0] for q in dn]), hold([q[1] for q in dn])
TX, TY = hold([BX + x for x, _ in TG]), hold([BY - y for _, y in TG])
b = [f'<rect class="robot-part" x="{BX - 30}" y="{BY}" width="60" height="12"/>',
     f'<circle r="11" fill="none" stroke="var(--orange)" stroke-width="2.5"><animate attributeName="cx" dur="{d}" repeatCount="indefinite" values="{joined(TX)}" keyTimes="{kt}"/><animate attributeName="cy" dur="{d}" repeatCount="indefinite" values="{joined(TY)}" keyTimes="{kt}"/></circle>',
     f'<circle cx="{BX}" cy="{BY}" r="{L1 + L2}" fill="none" stroke="rgba(255,255,255,.12)" stroke-dasharray="5 6"/>',
     '<g opacity=".45">' + arm2(BX, BY, L1, L2, D1, D2, kt, d, "arm", spline=True) + '</g>', arm2(BX, BY, L1, L2, U1, U2, kt, d, spline=True)]
LBL = ["two answers: elbow up and elbow down", "two answers again", "two answers, close to the base", "out of reach: no answer", "two answers"]
for i, t in enumerate(LBL):
    s0 = [0, .22, .44, .66, .92][i]; e0 = [.22, .44, .66, .92, 1][i]
    b.append(cap(t, s0, e0, d, 300, 262))
b += [at('<text class="code hot" x="610" y="150">IK: no solution</text>', .66, .92, d),
      box(590, 30, 290, 80, "FK: q → pose", "one answer · robot_state_publisher", "block"), box(590, 160, 290, 80, "IK: pose → q", "0, 1 or many · KDL, pick_ik", "block app")]
svgs["Forward and inverse kinematics"] = svg(272, "A two-link arm reaches an orange target. Inverse kinematics finds two answers, elbow up drawn solid and elbow down faded, for each of three targets; for a fourth target outside the dashed reach circle there is no solution. Panels note that forward kinematics has one answer and inverse kinematics zero, one or many.", "".join(b), " tall")

# ---------- Degrees of freedom and workspace: sample joint values, map the reachable set ----------
d = "12s"
L1, L2, BX, BY = 110, 80, 230, 200
rnd = random.Random(9)
S = [(rnd.uniform(-10, 190), rnd.uniform(-150, 150)) for _ in range(70)]
b = [f'<rect x="300" y="60" width="60" height="60" fill="#3a4566"/><text class="k" x="330" y="52">obstacle</text>', f'<rect class="robot-part" x="{BX - 30}" y="{BY}" width="60" height="12"/>',
     f'<path d="M{BX},{BY} L{BX + 40},{BY + 4} A40,40 0 0,1 {BX - 40},{BY + 4} Z" fill="rgba(255,114,159,.2)"/>', f'<text class="k" x="{BX}" y="{BY + 30}">joint 1 limit</text>']
for i, (a, c) in enumerate(S):
    _, (x, y) = fk2(a, c, L1, L2); px, py = BX + x, BY - y
    t0 = round(.02 + i / len(S) * .9, 4)
    blocked = 300 <= px <= 360 and 60 <= py <= 120
    b.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="3.2" fill="{"var(--pink)" if blocked else "var(--cyan)"}" opacity="0">{vis(t0, .99, d)}</circle>')
kt = even(len(S))
b.append(arm2(BX, BY, L1, L2, [a for a, _ in S], [c for _, c in S], kt, d, tip='<circle class="lidar" r="5"/>', w=(12, 9)))
b += [cap("random joint values → every point the tool can reach", 0, .93, d, 230, 300), cap("2 joints: a ring-shaped workspace with a hole", .93, 1, d, 230, 300)]
svgs["Degrees of freedom and workspace"] = svg(312, "A two-link arm jumps through random joint values and its tool tip leaves a dot each time, filling a ring-shaped reachable workspace. Dots inside an obstacle are pink, and a joint limit wedge below the base is never reached.", "".join(b), " tall", vb_w=460)

# ---------- ros2_control closes the loop ----------
d = "6s"
COLS = [(20, "Applications", "MoveIt 2 · teleop"), (250, "Controllers", "joint_trajectory · gripper"), (480, "Controller manager", ""), (710, "Hardware component", "robot or Gazebo")]
b = []
for x, k, n in COLS: b += [f'<rect class="{"hub" if k == "Controller manager" else "node"}" x="{x}" y="40" width="170" height="130" rx="8"/>', f'<text class="k" x="{x + 85}" y="62">{k}</text>', f'<text class="s" x="{x + 85}" y="92">{n}</text>' if n else '']
PH = [("read", "states in"), ("update", "controllers run"), ("write", "commands out")]
for i, (n, sub) in enumerate(PH):
    s0, e0 = round(i / 3, 3), round((i + 1) / 3, 3)
    b += [f'<rect class="block" x="496" y="{78 + i * 30}" width="138" height="24" rx="4"/><text class="code" x="508" y="{94 + i * 30}">{n}</text>',
          f'<rect x="496" y="{78 + i * 30}" width="138" height="24" rx="4" fill="rgba(88,224,210,.25)" stroke="var(--cyan)" opacity="0">{vis(s0 if s0 > 0 else .001, e0, d)}</rect>']
for i in range(3):
    x = 190 + i * 230
    b += [wire(f"M{x},90 L{x + 60},90"), wire(f"M{x + 60},130 L{x},130")]
    b += [packet("res", f"M{x},90 L{x + 60},90", round(.62 + i * .08, 3) if i else .7, round(.7 + i * .08, 3) if i else .78, d) if i == 2 else packet("res", f"M{x},90 L{x + 60},90", round(.36 + i * .1, 3), round(.46 + i * .1, 3), d),
          packet("req", f"M{x + 60},130 L{x},130", round(.02 + (2 - i) * .08, 3), round(.1 + (2 - i) * .08, 3), d)]
b += ['<text class="k" x="450" y="196">command interfaces flow right · state interfaces flow left</text>',
      '<rect class="res" x="290" y="210" width="12" height="12" rx="3"/><text class="code" x="310" y="221">position command</text><rect class="req" x="470" y="210" width="12" height="12" rx="3"/><text class="code" x="490" y="221">position, velocity state</text>']
svgs["ros2_control architecture"] = svg(232, "Four blocks: applications, controllers, the controller manager, and the hardware component. Inside the controller manager, read, update and write light up in turn; state interfaces flow from hardware towards the applications and command interfaces flow back to the hardware.", "".join(b), " tall")

# ---------- MoveIt 2 planning components ----------
d = "10s"
b = [box(10, 70, 170, 80, "RViz / app", "pose or joint goal", "node"), f'<rect class="hub" x="250" y="20" width="300" height="200" rx="10"/><text class="s" x="400" y="44">move_group</text>',
     box(720, 70, 170, 80, "trajectory controller", "FollowJointTrajectory", "node")]
INNER = [("planning scene", "robot + world + attached", .14), ("kinematics", "IK for the goal pose", .24), ("planning pipeline", "OMPL plan + time parameterization", .34)]
for i, (n, sub, t0) in enumerate(INNER):
    y = 62 + i * 50
    b += [box(270, y, 260, 40, "", cls="block", rx=5), f'<text class="code" x="284" y="{y + 25}">{n}</text><text class="k" x="470" y="{y + 24}">{sub.split(" ")[0]}</text>', flash(270, y, 260, 40, t0, d, 5),
          cap(sub, t0, round(t0 + .1, 3), d, 400, 248)]
b += [wire("M180,110 L250,110"), wire("M550,110 L720,110"), packet("req", "M180,110 L250,110", .04, .12, d), packet("res", "M550,110 L720,110", .46, .56, d), flash(720, 70, 170, 80, .56, d),
      cap("goal: move panda_hand to a pose", .02, .14, d, 400, 248), cap("trajectory: joint positions with times", .44, .58, d, 400, 248), cap("the controller executes; the scene keeps tracking", .58, 1, d, 400, 248)]
b.append(f'<g transform="translate(805 215)"><rect class="robot-part" x="-18" y="0" width="36" height="6"/>' + arm2(0, 0, 34, 26, [90, 90, 50, 50, 90], [-20, -20, -60, -60, -20], "0;.56;.8;.95;1", d, w=(8, 6), spline=True) + '</g>')
svgs["MoveIt 2 planning components"] = svg(258, "A goal goes from RViz or an application into move_group, where the planning scene, kinematics and the planning pipeline light up in turn. A trajectory goes out to the trajectory controller and a small arm executes it.", "".join(b), " tall")

# ---------- Controller lifecycle and interface claims ----------
d = "12s"
ROWS = [("unconfigured", 40), ("inactive", 115), ("active", 190), ("finalized", 265)]
b = ['<line class="divider" x1="70" y1="40" x2="70" y2="265"/>']
for n, y in ROWS: b.append(pill(70, y, n, 124, "pill topic" if n == "active" else "pill", 32))
def mover(name, x, ys, kt, cls):
    return (f'<g><rect class="{cls}" x="{x - 52}" y="-14" width="104" height="28" rx="6"/><text class="code" x="{x - 44}" y="5">{name}</text>'
            f'<animateTransform attributeName="transform" type="translate" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="{";".join([EASE] * (len(ys) - 1))}" values="{";".join(f"0 {y}" for y in ys)}" keyTimes="{kt}"/></g>')
b += ['<text class="k" x="215" y="16">broadcaster</text><text class="k" x="330" y="16">arm</text><text class="k" x="445" y="16">other_arm</text>',
      mover("state", 215, [40, 40, 190, 190], "0;.06;.16;1", "block"),
      mover("joints", 330, [40, 40, 115, 115, 190, 190], "0;.2;.28;.42;.5;1", "block app"),
      mover("joints", 445, [40, 40, 115, 115, 160, 115, 115], "0;.58;.64;.7;.75;.8;1", "block"),
      at('<text class="code hot" x="390" y="230">already</text><text class="code hot" x="390" y="248">claimed</text><line class="xmark" x1="436" y1="150" x2="454" y2="168"/><line class="xmark" x1="454" y1="150" x2="436" y2="168"/>', .74, 1, d),
      at('<rect x="282" y="210" width="96" height="62" rx="5" fill="rgba(255,177,90,.15)" stroke="var(--orange)"/><text class="code" x="290" y="230">joint1/pos</text><text class="code" x="290" y="246">joint2/pos</text><text class="code" x="290" y="262">joint3/pos</text>', .5, 1, d),
      cap("load + activate the broadcaster", 0, .2, d, 260, 300), cap("arm: inactive, then switched active", .2, .58, d, 260, 300), cap("same interfaces: activation refused", .58, 1, d, 260, 300)]
svgs["Controller lifecycle"] = svg(312, "Lifecycle states run top to bottom: unconfigured, inactive, active, finalized. The joint state broadcaster goes active; the arm controller is loaded inactive, then switched active and claims three joint position command interfaces; a second arm controller tries to activate and is refused because those interfaces are already claimed.", "".join(b), vb_w=520)

# ---------- Planning in configuration space ----------
d = "10s"
rnd = random.Random(5)
OBS = [(300, 60, 90, 140), (560, 120, 110, 150)]
inside = lambda x, y: any(ox <= x <= ox + w and oy <= y <= oy + h for ox, oy, w, h in OBS)
b = ['<rect class="block" x="20" y="10" width="860" height="270" rx="8"/>'] + [f'<rect x="{ox}" y="{oy}" width="{w}" height="{h}" rx="14" fill="rgba(255,114,159,.35)" stroke="var(--pink)"/>' for ox, oy, w, h in OBS]
b += ['<text class="k" x="345" y="128">collision</text>', '<text class="k" x="615" y="198">collision</text>']
for i in range(80):
    x, y = rnd.uniform(30, 870), rnd.uniform(20, 270); t0 = round(.02 + i * .0055, 4)
    bad = inside(x, y)
    b.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{"var(--pink)" if bad else "var(--blue)"}" opacity="0">{vis(t0, .97, d)}</circle>')
P = "M80,230 C180,230 230,240 300,230 C430,215 420,95 520,90 C620,85 700,90 720,60 L820,50"
b += [f'<path d="{P}" fill="none" stroke="var(--cyan)" stroke-width="4" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" dur="{d}" repeatCount="indefinite" values="1;1;0;0" keyTimes="0;.46;.66;1"/></path>',
      '<circle cx="80" cy="230" r="10" fill="var(--cyan)"/><text class="k" x="80" y="260">start</text><circle cx="820" cy="50" r="10" fill="var(--orange)"/><text class="k" x="820" y="80">goal</text>',
      f'<g opacity="0"><circle r="9" fill="var(--ink)"/><animateMotion dur="{d}" repeatCount="indefinite" path="{P}" keyPoints="0;0;1;1" keyTimes="0;.68;.95;1" calcMode="linear"/>{vis(.68, .97, d)}</g>',
      cap("sample joint vectors; reject the ones in collision", 0, .46, d, 450, 300), cap("connect valid states into a path", .46, .68, d, 450, 300), cap("move along it", .68, 1, d, 450, 300)]
svgs["Planning in configuration space"] = svg(312, "A configuration-space plane with two pink collision regions. Random samples appear, blue where valid and pink inside collisions; then a path from start to goal draws itself between the obstacles and a dot travels along it.", "".join(b), " tall")

# ---------- Joint motion and Cartesian motion ----------
d = "8s"
L1, L2 = 120, 100
A, B = (60, 150), (190, 40)
def plan(base, cart):
    qa, qb = ik2(*A, L1, L2, True), ik2(*B, L1, L2, True)
    out = []
    for i in range(41):
        f = i / 40
        out.append(ik2(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, L1, L2, True) if cart else (qa[0] + (qb[0] - qa[0]) * f, qa[1] + (qb[1] - qa[1]) * f))
    return out
b = []
for col, (bx, cart, lbl) in enumerate(((140, False, "joint-space plan · tool curves"), (590, True, "Cartesian path · tool goes straight"))):
    qs = plan(bx, cart); seq = qs + qs[::-1]; kt = even(len(seq))
    b += [f'<rect class="robot-part" x="{bx - 30}" y="230" width="60" height="12"/>', f'<line x1="{bx + A[0]}" y1="{230 - A[1]}" x2="{bx + B[0]}" y2="{230 - B[1]}" stroke="rgba(255,255,255,.18)" stroke-dasharray="5 5"/>',
          f'<circle cx="{bx + A[0]}" cy="{230 - A[1]}" r="6" fill="var(--cyan)"/><circle cx="{bx + B[0]}" cy="{230 - B[1]}" r="6" fill="var(--orange)"/>', f'<text class="s" x="{bx + 110}" y="270">{lbl}</text>']
    for i, (a, c) in enumerate(qs):
        _, (x, y) = fk2(a, c, L1, L2)
        b.append(f'<circle cx="{bx + x:.1f}" cy="{230 - y:.1f}" r="2.6" fill="{"var(--orange)" if cart else "var(--cyan)"}" opacity="0">{vis(round(i / (len(seq) - 1), 4) or .001, .5, d)}</circle>')
    b.append(arm2(bx, 230, L1, L2, [q[0] for q in seq], [q[1] for q in seq], kt, d, tip='<circle class="lidar" r="6"/>'))
svgs["Joint motion and Cartesian motion"] = svg(282, "Two arms move the tool between the same two points. Left: interpolating joint angles makes the tool tip trace a curve. Right: following a straight line in task space, solved with inverse kinematics at every step, keeps the tool on the dashed straight line.", "".join(b), " tall")

# ---------- A grasp is a sequence ----------
d = "10s"
def gripper(open_vals, kt):
    finger = lambda side: (f'<rect class="robot-part" x="{-4 if side < 0 else 0}" y="0" width="4" height="34" rx="1">'
                           f'<animate attributeName="x" dur="{d}" repeatCount="indefinite" values="{joined((-v - 4) if side < 0 else v for v in open_vals)}" keyTimes="{kt}"/></rect>')
    return f'<rect class="robot-body" x="-36" y="-16" width="72" height="16" rx="3"/><rect class="robot-part" x="-5" y="-80" width="10" height="64"/>{finger(-1)}{finger(1)}'
KT = "0;.12;.3;.42;.52;.7;.88;1"
GX = [220, 220, 220, 220, 220, 260, 220, 220]; GY = [60, 60, 120, 120, 120, 50, 50, 60]; OPEN = [30, 30, 30, 30, 16, 16, 30, 30]
OY = [0, 0, 0, 0, 0, -70, -70, 0]
b = ['<rect x="80" y="214" width="300" height="10" fill="#3a4566"/>',
     f'<g><rect x="203" y="174" width="34" height="40" rx="3" class="res"/><animateTransform attributeName="transform" type="translate" dur="{d}" repeatCount="indefinite" values="{";".join(f"{(x - 220) if i in (5, 6) else 0} {v}" for i, (x, v) in enumerate(zip(GX, OY)))}" keyTimes="{KT}"/></g>',
     f'<g><g>{gripper(OPEN, KT)}</g><animateTransform attributeName="transform" type="translate" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="{";".join([EASE] * 7)}" values="{";".join(f"{x} {y}" for x, y in zip(GX, GY))}" keyTimes="{KT}"/></g>',
     '<path d="M220,96 L220,150" stroke="rgba(255,255,255,.25)" stroke-dasharray="4 4"/>']
STG = [("01", "Pre-grasp", "safe pose above the object", .02, .2), ("02", "Approach", "straight down, constrained", .2, .42), ("03", "Close", "grip, then attach to the scene", .42, .52), ("04", "Lift + retreat", "carry it clear, checking collisions", .52, .9)]
for i, (n, t, sub, s0, e0) in enumerate(STG):
    y = 20 + i * 62
    b += [f'<rect class="block" x="470" y="{y}" width="410" height="52" rx="6"/><text class="code" x="486" y="{y + 22}">{n}</text><text class="s left" x="520" y="{y + 22}">{t}</text><text class="k left" x="520" y="{y + 40}">{sub}</text>',
          f'<rect x="470" y="{y}" width="410" height="52" rx="6" fill="rgba(88,224,210,.12)" stroke="var(--cyan)" stroke-width="2" opacity="0">{vis(s0, e0, d)}</rect>']
svgs["A grasp is a sequence"] = svg(272, "A gripper moves to a pre-grasp pose above an orange box, approaches straight down, closes, then lifts and retreats with the box. A list of the four stages, pre-grasp, approach, close, and lift and retreat, highlights each stage as it happens.", "".join(b), " tall")

# ---------- Object state during pick and place ----------
d = "12s"
KT = "0;.15;.25;.3;.55;.65;.72;.85;1"
GX = [150, 150, 150, 150, 600, 600, 600, 600, 150]; GY = [40, 40, 110, 110, 70, 110, 110, 40, 40]; OPEN = [30, 30, 30, 16, 16, 16, 30, 30, 30]
BX_ = [0, 0, 0, 0, 450, 450, 450, 450, 0]; BY_ = [0, 0, 0, 0, -40, 0, 0, 0, 0]
b = ['<rect x="60" y="194" width="200" height="10" fill="#3a4566"/><text class="k" x="160" y="222">table A</text><rect x="510" y="194" width="200" height="10" fill="#3a4566"/><text class="k" x="610" y="222">table B</text>',
     f'<g><rect x="133" y="154" width="34" height="40" rx="3" fill="var(--green)"><animate attributeName="fill" dur="{d}" repeatCount="indefinite" calcMode="discrete" values="#7ddc7a;#7ddc7a;#ffb15a;#7ddc7a;#7ddc7a" keyTimes="0;.3;.3;.65;1"/></rect>'
     f'<animateTransform attributeName="transform" type="translate" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="{";".join([EASE] * 8)}" values="{";".join(f"{x} {y}" for x, y in zip(BX_, BY_))}" keyTimes="{KT}"/></g>',
     f'<g><g>{gripper(OPEN, KT)}</g><animateTransform attributeName="transform" type="translate" dur="{d}" repeatCount="indefinite" calcMode="spline" keySplines="{";".join([EASE] * 8)}" values="{";".join(f"{x} {y}" for x, y in zip(GX, GY))}" keyTimes="{KT}"/></g>',
     term(740, 20, 150, 170, "planning scene")]
STATE = [("world: box", "attached: —", 0, .3), ("world: —", "attached: box", .3, .65), ("world: box (B)", "attached: —", .65, 1)]
for w_, a_, s0, e0 in STATE:
    b.append(at(f'<text class="code" x="752" y="66">{w_}</text><text class="code hot" x="752" y="92">{a_}</text>', s0, e0, d))
b += [cap("world object: the planner avoids it", 0, .3, d, 400, 254), cap("attached: it moves with the hand and is not a collision with it", .3, .65, d, 400, 254), cap("detached at the placed pose: a world object again", .65, 1, d, 400, 254)]
svgs["Object state during pick and place"] = svg(264, "A gripper picks a box from table A and places it on table B. The box is green while it is a world object, turns orange while attached to the hand, and goes green again once placed; a planning-scene panel lists where the box is at each stage.", "".join(b), " tall")

# ---------- Grasp feasibility filters ----------
d = "12s"
CX, CY = 300, 150
rnd = random.Random(12)
G = []
for i in range(24):
    a = i / 24 * 2 * math.pi
    reach = not (math.cos(a) > .55)                  # from behind the object: unreachable
    coll = reach and not (math.sin(a) < -.6)          # from below: hits the table
    exe = coll and not (abs(math.cos(a)) < .25 and math.sin(a) > 0 and i % 2)   # no room to approach
    G.append((a, reach, coll, exe))
STAGE_T = [.02, .26, .5, .74]
b = [f'<rect x="{CX - 160}" y="{CY + 40}" width="320" height="10" fill="#3a4566"/>', f'<rect x="{CX - 22}" y="{CY - 26}" width="44" height="66" rx="4" class="res"/>',
     f'<rect x="{CX + 80}" y="{CY - 60}" width="40" height="100" fill="#3a4566"/><text class="k" x="{CX + 100}" y="{CY - 70}">robot side</text>']
for a, reach, coll, exe in G:
    x0, y0 = CX + 100 * math.cos(a), CY - 100 * math.sin(a); x1, y1 = CX + 46 * math.cos(a), CY - 46 * math.sin(a)
    die = .26 if not reach else .5 if not coll else .74 if not exe else 1
    line = f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke-width="3" stroke-linecap="round"'
    b.append(f'{line} stroke="var(--cyan)" opacity="0">{vis(.02, die, d)}</line>')
    if die < 1: b.append(f'{line} stroke="var(--pink)" opacity="0">{vis(die, min(die + .08, .97), d)}</line>')
    else: b.append(f'{line} stroke="var(--green)" stroke-width="5" opacity="0">{vis(.74, 1, d)}</line>')
counts = [24, sum(r for _, r, _, _ in G), sum(c for _, _, c, _ in G), sum(e for *_, e in G)]
ROWS = [("Sampled grasp poses", "geometry + strategy"), ("Reachable", "inverse kinematics"), ("Collision-free", "hand + arm + object"), ("Executable", "approach + close + lift")]
for i, ((n, sub), c) in enumerate(zip(ROWS, counts)):
    y = 20 + i * 62; s0 = STAGE_T[i]
    b += [f'<rect class="block" x="560" y="{y}" width="320" height="52" rx="6"/><text class="s left" x="576" y="{y + 22}">{n}</text><text class="k left" x="576" y="{y + 40}">{sub}</text>',
          at(f'<text class="code ok" x="830" y="{y + 32}">{c}</text>', s0, 1, d), flash(560, y, 320, 52, s0, d)]
svgs["Grasp feasibility filters"] = svg(272, f"Twenty-four candidate grasp directions surround a box. Filters remove them in stages: unreachable ones from the robot's far side, ones that would hit the table, and ones without room to approach, leaving {counts[3]} executable grasps highlighted in green. Counts beside each stage read {', '.join(map(str, counts))}.", "".join(b), " tall")
# ======================================================================
# Every slide acts out its idea. Shared helpers for the rest of the file.
# ======================================================================
def tl(x, y0, step, items, dur, frac=.03):
    """Terminal lines: (kind, text, start[, end]); kind is type, show, ok, hot or dim. Lines stack from y0."""
    out_ = []
    for i, it in enumerate(items):
        kind, text, s0 = it[:3]; e0 = it[3] if len(it) > 3 else 1
        y = y0 + i * step
        if kind == "type": out_.append(typed(x, y, text, s0, dur, frac, e0 if e0 < 1 else None))
        else: out_.append(shown(x, y, text, s0, dur, e0, {"show": "code", "ok": "code ok", "hot": "code hot", "dim": "code dim"}[kind]))
    return "".join(out_)

def move(inner, pts, kt, dur, spline=True):
    mode = f'calcMode="spline" keySplines="{";".join([EASE] * (len(pts) - 1))}"' if spline else 'calcMode="discrete"'
    return f'<g>{inner}<animateTransform attributeName="transform" type="translate" dur="{dur}" repeatCount="indefinite" {mode} values="{";".join(f"{x} {y}" for x, y in pts)}" keyTimes="{kt}"/></g>'

def swap(texts, x, y, dur, cls="code", anchor=""):
    """One text slot whose content changes: [(start, end, text), ...]."""
    a = f' text-anchor="{anchor}"' if anchor else ""
    return "".join(f'<text class="{cls}" x="{x}" y="{y}"{a} opacity="0">{t}{vis(s0, e0, dur)}</text>' for s0, e0, t in texts)

def chip(x, y, w, h, title, sub="", cls="block", rx=5):
    """A labelled box: sub is a small caption on top, title the value below it (or centred when there is no caption)."""
    ty = y + 33 if sub else (y + 20 if h > 44 else y + h / 2 + 4)
    return (f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>'
            + (f'<text class="k left" x="{x + 8}" y="{y + 14}">{sub}</text>' if sub else '')
            + (f'<text class="code" x="{x + 8}" y="{ty}">{title}</text>' if title else ''))

def rover(x, y, s=1):
    return (f'<g transform="translate({x} {y}) scale({s})"><rect class="robot-body" x="-22" y="-14" width="44" height="20" rx="6"/>'
            '<circle class="wheel" cx="-12" cy="8" r="7"/><circle class="wheel" cx="12" cy="8" r="7"/><rect class="robot-part" x="-4" y="-24" width="8" height="10"/><circle class="lens" cx="0" cy="-26" r="4"/></g>')

# ---------- Prerequisites divider: a terminal makes a robot move ----------
d = "8s"
b = [term(150, 10, 330, 120, "terminal"), tl(164, 52, 22, [("type", "$ python3 rover.py", .05), ("ok", "rover: 0.3 m/s", .22)], d),
     '<line class="divider" x1="520" y1="150" x2="880" y2="150"/>',
     move(rover(560, 128, 1.3), [(0, 0), (0, 0), (290, 0), (290, 0)], "0;.25;.85;1", d), cap("Linux runs it · Python describes it · the robot moves", .25, 1, d, 515, 190)]
svgs["Prerequisites"] = svg(200, "A terminal runs python3 rover.py, prints rover: 0.3 m/s, and a small rover drives across.", "".join(b))

# ---------- Navigate the file system: a terminal and the folder tree it changes ----------
d = "16s"
CMD = [("type", "$ mkdir -p ~/ros2_ws/src", .02), ("type", "$ cd ~/ros2_ws/src", .1), ("type", "$ nano a.py", .18), ("type", "$ cp a.py b.py", .26), ("type", "$ mv b.py talker.py", .34),
       ("type", "$ ls -la", .42), ("show", "a.py  talker.py", .46), ("type", "$ rm a.py", .52), ("type", "$ cd ..", .62), ("type", "$ pwd", .7), ("ok", "/home/ada/ros2_ws", .74), ("type", "$ cat src/talker.py", .8), ("show", "print('hello')", .84)]
b = [term(10, 10, 450, 280, "bash · Tab completes names"), tl(24, 50, 18.5, CMD, d)]
NODE = lambda x, y, n, cls="code": f'<text class="{cls}" x="{x}" y="{y}">{n}</text>'
b += [NODE(560, 52, "/home/ada"), '<path class="trail" d="M566,60 L566,96 L590,96"/>', at(NODE(596, 100, "ros2_ws/") + '<path class="trail" d="M606,108 L606,146 L630,146"/>' + NODE(636, 150, "src/"), .05, 1, d),
      '<path class="trail" d="M646,158 L646,236 L670,236" opacity=".9"/>',
      at(NODE(676, 200, "a.py") + '<path class="trail" d="M646,196 L670,196"/>', .21, .56, d), at(f'<line class="xmark" x1="672" y1="196" x2="712" y2="196"/>', .54, .58, d),
      at(NODE(676, 240, "b.py"), .3, .38, d), at(NODE(676, 240, "talker.py"), .38, 1, d), packet("req", "M690,206 L690,232", .28, .31, d)]
MK = '<path d="M0,0 L-14,-7 L-14,7 Z" fill="var(--orange)"/><text class="code hot" x="-120" y="5">you are here</text>'
b.append(move(MK, [(552, 48), (552, 48), (628, 146), (628, 146), (588, 96), (588, 96)], "0;.12;.15;.64;.67;1", d))
b.append(f'<text class="k" x="720" y="285">rm deletes for good: there is no bin</text>')
svgs["Navigate the file system"] = svg(300, "A terminal runs mkdir, cd, nano, cp, mv, ls, rm, cd .., pwd and cat. Beside it a folder tree grows: ros2_ws and src appear, a.py is created, copied to b.py, b.py renamed to talker.py, a.py deleted, and an orange you-are-here marker moves into src and back up to ros2_ws.", "".join(b), " tall")

# ---------- Processes, search, and permissions ----------
d = "16s"
CMD = [("type", "$ ros2 run demo_nodes_py talker", .01), ("show", "[INFO] Publishing: 'Hello World: 7'", .04), ("hot", "^C  (node stopped)", .09),
       ("type", "$ ps aux | grep ros", .14), ("show", "ada 4242 … ros2 run … listener", .3), ("type", "$ kill 4242", .36), ("type", "$ grep -rn \"chatter\" src/", .46), ("show", "src/talker.py:12: 'chatter'", .52),
       ("type", "$ chmod +x script.py", .6), ("type", "$ ls -l script.py", .68), ("ok", "-rwxr-xr-x  script.py", .72), ("type", "$ sudo apt install ros-jazzy-rqt", .8)]
b = [term(10, 10, 450, 280, "bash"), tl(24, 50, 19, CMD, d)]
# the pipe: five lines leave ps aux, only the ros ones get through grep
b += [chip(500, 20, 90, 30, "ps aux"), chip(690, 20, 110, 30, "grep ros", cls="block app"), '<text class="k" x="640" y="16">| the pipe</text>', '<path class="trail" d="M590,35 L690,35"/><path class="trail" d="M800,35 L880,35"/>']
for k, name in enumerate(["systemd", "bash", "listener", "gnome", "ros2 daemon"]):
    ok = "listener" in name or "ros2" in name; t0 = round(.17 + k * .025, 3)
    b.append(packet("req" if ok else "bad", "M590,35 L690,35" + (" L800,35 L880,35" if ok else ""), t0, round(t0 + (.06 if ok else .03), 3), d))
    if not ok: b.append(burst(690, 35, round(t0 + .03, 3), d))
b += ['<text class="k" x="690" y="70">only matching lines pass</text>']
# kill
b += [chip(500, 90, 380, 30, "4242  listener    CPU"), at('<rect x="760" y="98" width="90" height="14" fill="var(--cyan)" opacity=".7"><animate attributeName="width" dur="1.2s" repeatCount="indefinite" values="40;90;55;80;40"/></rect>', 0, .4, d),
      at('<line class="xmark" x1="505" y1="105" x2="875" y2="105"/><text class="code hot" x="760" y="140">stopped</text>', .4, 1, d)]
# grep -rn and chmod
b += [chip(500, 160, 380, 30, "src/talker.py"), at('<rect x="500" y="160" width="380" height="30" rx="5" fill="none" stroke="var(--orange)" stroke-width="2"/><text class="code hot" x="660" y="180">line 12: chatter</text>', .52, 1, d),
      chip(500, 220, 380, 34, ""), swap([(0, .64, "-rw-r--r--  script.py"), (.64, 1, "-rwxr-xr-x  script.py")], 512, 242, d), at('<text class="code ok" x="720" y="242">x = executable</text>', .64, 1, d)]
svgs["Processes, search, and permissions"] = svg(300, "A terminal stops a running talker with Ctrl+C, then runs ps aux | grep ros: five process lines leave ps aux and only the two ROS lines pass through grep. kill 4242 strikes out the listener process, grep -rn finds chatter on line 12 of talker.py, and chmod +x turns -rw-r--r-- into -rwxr-xr-x.", "".join(b), " tall")

# ---------- Environment and packages: what each terminal knows ----------
d = "16s"
TABS = [(5, "tab 1"), (160, "tab 2 (already open)"), (315, "new tab")]
b = []
for x, n in TABS: b += [f'<rect class="term" x="{x}" y="10" width="140" height="170" rx="6"/><rect class="termbar" x="{x}" y="10" width="140" height="22" rx="6"/><text class="k" x="{x + 70}" y="22">{n}</text>']
b += [at('<rect class="term" x="315" y="10" width="140" height="170" rx="6" fill="#080d19"/><text class="k" x="385" y="100">not open yet</text>', 0, .8, d),
      '<rect class="block" x="5" y="200" width="290" height="34" rx="5"/><text class="code" x="14" y="222">/opt/ros/jazzy</text>', at('<text class="code ok" x="140" y="222">+ turtlesim</text>', .1, 1, d),
      '<rect class="block" x="315" y="200" width="140" height="34" rx="5"/><text class="code" x="324" y="222">~/.bashrc</text>', at('<text class="code ok" x="394" y="222">+1 line</text>', .72, 1, d),
      packet("res", "M80,180 L80,200", .06, .1, d),
      swap([(.18, .5, "ROS_DISTRO=")], 14, 52, d, "code dim"), at('<text class="code ok" x="14" y="52">ROS_DISTRO=jazzy</text>', .5, 1, d),
      at('<text class="code ok" x="14" y="74">ROS_DOMAIN_ID=7</text>', .3, 1, d), at('<text class="code ok" x="14" y="96">AMENT_PREFIX…</text>', .5, 1, d),
      at('<text class="code hot" x="169" y="52">ROS_DOMAIN_ID</text><text class="code hot" x="169" y="72">not set</text>', .58, 1, d),
      packet("res", "M385,200 L385,170", .82, .87, d), at('<text class="code ok" x="324" y="52">ROS_DOMAIN_ID=7</text><text class="code dim" x="324" y="74">from .bashrc</text>', .87, 1, d),
      cap("export lasts for one terminal", .3, .7, d, 230, 262), cap(".bashrc runs in every new terminal", .7, 1, d, 230, 262), cap("apt installs into /opt/ros/jazzy", 0, .3, d, 230, 262)]
svgs["Environment and packages"] = svg(272, "Three terminal tabs. apt installs turtlesim into /opt/ros/jazzy. In tab 1, ROS_DISTRO is empty until setup.bash is sourced, and export sets ROS_DOMAIN_ID=7; tab 2 never sees it. After the export line is appended to ~/.bashrc, a new tab starts with ROS_DOMAIN_ID=7.", "".join(b), vb_w=460,
                                         trace=[(0, "2-3"), (.18, 6), (.3, 7), (.4, 8), (.5, 11), (.58, 0), (.72, 14), (.85, 0)])

# ---------- Self-check: Linux ----------
d = "14s"
b = [f'<rect class="term" x="5" y="5" width="220" height="150" rx="6"/><rect class="termbar" x="5" y="5" width="220" height="20" rx="6"/><text class="k" x="115" y="16">tab 1</text>',
     f'<rect class="term" x="235" y="5" width="220" height="150" rx="6"/><rect class="termbar" x="235" y="5" width="220" height="20" rx="6"/><text class="k" x="345" y="16">new tab</text>',
     at('<rect class="term" x="235" y="25" width="220" height="130" fill="#080d19"/><text class="k" x="345" y="90">Ctrl+Shift+T</text>', 0, .74, d),
     tl(14, 46, 20, [("show", "~/ros2_ws/src/hello.txt", .3), ("type", "$ export ROBOT_NAME=turtle", .48), ("type", "$ echo $ROBOT_NAME", .58), ("ok", "turtle", .64)], d),
     tl(244, 46, 20, [("type", "$ echo $ROBOT_NAME", .78), ("hot", "(empty line)", .84)], d), at('<text class="code hot" x="244" y="110">the variable stayed</text><text class="code hot" x="244" y="128">in tab 1</text>', .88, 1, d)]
svgs["Self-check: Linux"] = svg(160, "Tab 1 finds ~/ros2_ws/src/hello.txt, exports ROBOT_NAME=turtle and echoes turtle. A new tab echoes an empty line, because the variable stayed in tab 1.", "".join(b), vb_w=460,
                               trace=[(0, "1-2"), (.12, 3), (.22, "4-5"), (.46, 7), (.56, 8), (.74, 10), (.78, 11)])

# ---------- Python basics: values in memory, a loop, a branch, a function ----------
d = "16s"
b = [at(chip(5, 5, 140, 40, "0.5", "speed · float"), .02, 1, d), at(chip(155, 5, 150, 40, "'turtle1'", "name · str"), .06, 1, d),
     at(chip(5, 55, 300, 44, "", "joints · list") + '<rect class="block" x="13" y="69" width="100" height="22" rx="3"/><text class="code" x="21" y="85">\'joint1\'</text><rect class="block" x="118" y="69" width="100" height="22" rx="3"/><text class="code" x="126" y="85">\'joint2\'</text>', .1, 1, d),
     at(chip(315, 5, 140, 90, "", "limits · dict") + '<text class="code" x="323" y="42">max_speed</text><text class="code" x="345" y="66">→ 1.0</text>', .14, 1, d),
     term(5, 110, 300, 150, "output"),
     tl(16, 150, 20, [("show", "turtle1 moves at 0.5 m/s", .22), ("show", "joint1", .34), ("show", "joint2", .42), ("show", "ok", .64), ("ok", "clamp(1.7, 0.0, 1.0) → 1.0", .84)], d),
     at(move('<path d="M0,0 L-7,-10 L7,-10 Z" fill="var(--orange)"/>', [(63, 67), (63, 67), (168, 67), (168, 67)], "0;.4;.42;1", d, False), .3, .48, d),
     at('<rect class="block app" x="315" y="110" width="140" height="70" rx="6"/><text class="code" x="325" y="134">0.5 &gt; 1.0 ?</text><text class="code hot" x="325" y="160">False → else</text>', .5, .74, d),
     at('<rect class="block app" x="315" y="190" width="140" height="70" rx="6"/><text class="code" x="325" y="214">def clamp(…)</text><text class="code ok" x="325" y="240">max(low, min(…))</text>', .74, 1, d)]
svgs["Python basics"] = svg(268, "Values appear in memory as typed boxes: speed 0.5 float, name turtle1 string, a joints list with two items, and a limits dictionary mapping max_speed to 1.0. The output panel prints the f-string, then a pointer walks the list printing joint1 and joint2, the comparison 0.5 greater than 1.0 is False so else prints ok, and clamp turns 1.7 into 1.0.", "".join(b), vb_w=460,
                           trace=[(0, 1), (.06, 2), (.1, "3-4"), (.2, 6), (.3, "8-9"), (.5, 11), (.6, "13-14"), (.74, "16-17")])

# ---------- Classes and objects: build a Rover, then drive it ----------
d = "14s"
b = [chip(5, 5, 200, 100, "class Robot", ""), '<text class="code dim" x="15" y="50">name · speed</text><text class="code dim" x="15" y="72">__init__(name)</text><text class="code dim" x="15" y="94">drive(speed)</text>',
     chip(5, 150, 200, 60, "class Rover(Robot)", ""), '<text class="code dim" x="15" y="196">__init__()</text>', '<path class="wire" d="M105,150 L105,108"/><text class="k" x="150" y="132">inherits</text>',
     at(chip(255, 40, 200, 110, "r: Rover object", "", "block app"), .06, 1, d),
     swap([(.06, .3, "name = ?"), (.3, 1, "name = 'rover'")], 265, 92, d), swap([(.06, .3, "speed = ?"), (.3, .6, "speed = 0.0"), (.6, 1, "speed = 0.3")], 265, 116, d),
     at('<path class="trail" d="M205,180 L255,130"/>', .06, .3, d), packet("fb", "M120,150 L120,108", .18, .24, d), at('<text class="code ok" x="210" y="230">super().__init__(\'rover\')</text>', .18, .4, d),
     term(255, 170, 200, 60, "output"), at('<text class="code" x="265" y="214">rover: 0.3 m/s</text>', .7, 1, d),
     move(rover(300, 255, .9), [(0, 0), (0, 0), (130, 0), (130, 0)], "0;.62;.9;1", d)]
svgs["Classes and objects"] = svg(272, "A Robot class and a Rover class that inherits from it. r = Rover() creates an object; Rover's __init__ calls super().__init__ with 'rover', which fills name = 'rover' and speed = 0.0. r.drive(0.3) sets speed to 0.3, prints rover: 0.3 m/s, and a rover drives across.", "".join(b), vb_w=460,
                                 trace=[(0, 14), (.08, "10-11"), (.16, 12), (.22, "2-4"), (.42, 15), (.52, "6-8"), (.9, 0)])

# ---------- Imports and callbacks: hand over the function, it is called later ----------
d = "14s"
b = [at(chip(5, 5, 110, 30, "math") + chip(125, 5, 200, 30, "std_msgs.msg.String"), .02, 1, d),
     chip(5, 60, 170, 50, "on_message(text)", ""), '<text class="code dim" x="13" y="98">print(…)</text>',
     chip(250, 60, 205, 80, "subscribe(callback)", ""), '<rect class="block app" x="262" y="96" width="180" height="30" rx="4"/>', at('<text class="code ok" x="272" y="116">callback = on_message</text>', .26, .78, d),
     packet("fb", "M175,85 L262,111", .2, .26, d), '<text class="k" x="212" y="70">the function itself</text>']
for k, word in enumerate(["'hello'", "'world'"]):
    t0 = round(.34 + k * .16, 3)
    b += [at(f'<text class="code hot" x="350" y="160">{word}</text>', t0, round(t0 + .08, 3), d), packet("req", "M300,111 C230,150 160,150 90,110", round(t0 + .04, 3), round(t0 + .1, 3), d)]
b += [term(5, 170, 240, 92, "output"), tl(15, 210, 20, [("show", "received: hello", .44), ("show", "received: world", .6), ("ok", "3.141592653589793", .9)], d),
      at('<text class="code hot" x="255" y="210">subscribe(on_message())</text><text class="code hot" x="255" y="230">would call it now:</text><text class="code hot" x="255" y="250">TypeError</text>', .66, .82, d)]
svgs["Imports and callbacks"] = svg(270, "Two imports appear. subscribe receives the function on_message itself, not its result. Later, subscribe calls it with hello and then world, and the output shows received: hello and received: world. A warning notes that subscribe(on_message()) would call it immediately and fail. Finally main prints pi.", "".join(b), vb_w=460,
                                   trace=[(0, "1-2"), (.1, "4-5"), (.18, 12), (.26, "7-10"), (.36, "4-5"), (.66, 0), (.84, "17-18"), (.88, "14-15")])

# ---------- Self-check: Python: the battery drains through the callback ----------
d = "14s"
b = ['<rect class="block" x="5" y="10" width="200" height="40" rx="6"/>', '<rect x="205" y="22" width="8" height="16" fill="var(--line)"/>',
     f'<rect x="9" y="14" height="32" rx="4" fill="var(--cyan)"><animate attributeName="width" dur="{d}" repeatCount="indefinite" calcMode="discrete" values="{";".join(f"{192 - 19.2 * k:.1f}" for k in range(9))};38.4" keyTimes="0;{";".join(f"{(.06 + k * .08):.2f}" for k in range(8))};1"/></rect>',
     '<line x1="43" y1="8" x2="43" y2="52" stroke="var(--pink)" stroke-width="2" stroke-dasharray="3 3"/><text class="code hot" x="35" y="66">20%</text>',
     term(225, 5, 230, 150, "output")]
LOG = [(f"battery {100 - 10 * (k + 1)}%", round(.06 + k * .08, 2)) for k in range(8)] + [("battery low", .7), ("battery low", .8)]
for j, (txt, t0) in enumerate(LOG):
    row = min(j, 5); e0 = round(LOG[j + 6][1], 2) if j + 6 < len(LOG) else 1
    b.append(shown(235, 45 + (j % 6) * 18, txt, t0, d, e0 if j < 6 else 1, "code hot" if "low" in txt else "code"))
b.append(move(rover(30, 120, .9), [(0, 0)] + [(k * 18, 0) for k in range(1, 9)] + [(144, 0)], "0;" + ";".join(f"{(.06 + k * .08):.2f}" for k in range(8)) + ";1", d, False))
svgs["Self-check: Python"] = svg(160, "A battery gauge drains from 100 percent in steps of 10 as a rover drives forward; each change prints through the callback, battery 90 percent down to battery 20 percent. At 20 percent the robot refuses to drive and prints battery low twice.", "".join(b), vb_w=460,
                                trace=[(0, "14-16"), (.05, "7-8"), (.07, "11-12"), (.68, "8-10")])
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
