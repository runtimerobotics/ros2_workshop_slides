# Changelog

To publish a release: add a section for the new version at the top, set `VERSION` to it,
and push to `main`. The Release workflow tags the commit and attaches a zip of the deck.

## v1.1: Inside a robot, rebuilt around sense, think, act (2026-10-31)

The primer before Day 1 now tells one story on one robot: our own `demo_arm`, the arm the
labs build, simulate and program. 186 slides; the chapter takes about 60 minutes.

- **Where the three days lead** (slide 2): the arm finds the boxes with its camera and
  places them in the tray, while the panel walks Day 1, 2 and 3
- **New: Sense, think, act: the loop**, on the arm, with a one-stage-at-a-time mode
- **Sense:** new animated gallery of nine sensors (encoder, IMU, lidar, camera, depth camera,
  force-torque, contact, ultrasonic, GPS) and a new slide of the six sensors on our arm with
  their real topics; then the sorting game
- **Think:** new slide on the robot's computers, microcontroller to cloud, and what runs where
  on our arm, a TurtleBot3 and a self-driving car; then the autonomy stack, "When thinking is
  slow" (the latency demo, now after the loop it builds on) and loop rates
- **Act:** new animated gallery of seven actuators (DC motor and gearbox, servo, stepper,
  brushless joint motor, linear actuator, two-jaw gripper, suction cup) and a new drive-chain
  slide with a gear-ratio slider; then feedback control
- **Together:** new exploded anatomy of our arm, every part tagged sense, think or act; the
  TurtleBot3 anatomy stays as an optional mobile-robot contrast
- Quick check: three more questions, now on two slides
- "Write an action server" shows the logged cancel callback now in ros2_workshop_code
- Canvas diagrams scale down on phones instead of overlapping

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
