# Changelog

To publish a release: add a section for the new version at the top, set `VERSION` to it,
and push to `main`. The Release workflow tags the commit and attaches a zip of the deck.

## v1.0: workshop slides before the Inside a robot rework (2026-10-31)

The 178-slide deck for the three-day ROS 2 workshop, as taught before the "Inside a robot"
chapter is reworked around sense, think, act.

- Cover: Lentin Joseph, Co-Founder of RUNTIME Robotics; ROS 2 Jazzy (Ubuntu 24.04) and
  ROS 2 Lyrical (Ubuntu 26.04)
- Day 1 ROS 2 communication, Day 2 model and simulation, Day 3 manipulation, with
  interactive 3D scenes and animated diagrams
- Code on the slides matches [ros2_workshop_code](https://github.com/runtimerobotics/ros2_workshop_code),
  checked by `tools/check_code.py`
- `workshop-resources.html`: links and resources for participants

**View offline:** download `ros2_workshop_slides-v1.0.zip`, unzip it, run
`python3 -m http.server` in the folder, and open <http://localhost:8000>.
