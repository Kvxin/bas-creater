def text c {
    content = "bilibili"
    fontSize = 10%
    x = 50%
    y = 50%
    anchorX = 0.5
    anchorY = 0.5
}
set c {} 2s
then set c {
    content = "干杯"
} 3s

def text p {
    content = "parallel"
    alpha = 0.5
}
set p { x = 30% } 1s, "ease-in"
set p { alpha = 1 rotateZ = 180 } 2s
