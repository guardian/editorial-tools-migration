addSbtPlugin("org.playframework" % "sbt-plugin" % "3.0.12")
addSbtPlugin("org.scalameta" % "sbt-scalafmt" % "2.6.2")

libraryDependencies += "org.vafer" % "jdeb" % "1.14" artifacts Artifact("jdeb", "jar", "jar")

addDependencyTreePlugin
